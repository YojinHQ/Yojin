import type { AgentStepResult, Workflow, WorkflowStep } from './types.js';
import type { AgentRuntime } from '../core/agent-runtime.js';
import type { InsightStore } from '../insights/insight-store.js';
import { registerProcessInsightsWorkflow } from '../insights/workflow.js';
import { createSubsystemLogger } from '../logging/logger.js';
import type { ReflectionEngine } from '../memory/reflection.js';

const logger = createSubsystemLogger('orchestrator');

// ---------------------------------------------------------------------------
// Workflow progress events
// ---------------------------------------------------------------------------

export interface WorkflowProgressEvent {
  workflowId: string;
  stage: 'start' | 'stage_start' | 'stage_complete' | 'complete' | 'error';
  stageIndex?: number;
  totalStages?: number;
  agentIds?: string[];
  error?: string;
  timestamp: string;
}

/** Optional callback fired when a workflow progresses through stages. */
let progressCallback: ((event: WorkflowProgressEvent) => void) | null = null;

/** Register a callback to receive workflow progress events. */
export function setWorkflowProgressCallback(cb: (event: WorkflowProgressEvent) => void): void {
  progressCallback = cb;
}

function emitProgress(event: WorkflowProgressEvent): void {
  if (progressCallback) {
    try {
      progressCallback(event);
    } catch (err) {
      logger.warn('Progress callback threw', { error: err });
    }
  }
}

/** Extract agent IDs from a workflow stage (single step or parallel steps). */
function stageAgentIds(stage: WorkflowStep | WorkflowStep[]): string[] {
  return Array.isArray(stage) ? stage.map((s) => s.agentId) : [stage.agentId];
}

export class Orchestrator {
  private workflows = new Map<string, Workflow>();
  private readonly runtime: AgentRuntime;

  constructor(runtime: AgentRuntime) {
    this.runtime = runtime;
  }

  register(workflow: Workflow): void {
    this.workflows.set(workflow.id, workflow);
  }

  async execute(
    workflowId: string,
    trigger: { message?: string; sessionKey?: string },
  ): Promise<Map<string, AgentStepResult>> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const totalStages = workflow.stages.length;

    logger.info(`Executing workflow: ${workflow.name}`, { workflowId });
    emitProgress({ workflowId, stage: 'start', totalStages, timestamp: new Date().toISOString() });

    const outputs = new Map<string, AgentStepResult>();

    try {
      let stageIndex = 0;
      for (const stage of workflow.stages) {
        const agentIds = stageAgentIds(stage);

        emitProgress({
          workflowId,
          stage: 'stage_start',
          stageIndex,
          totalStages,
          agentIds,
          timestamp: new Date().toISOString(),
        });

        if (Array.isArray(stage)) {
          const results = await Promise.all(stage.map((step) => this.executeStep(step, outputs, trigger, true)));
          for (const result of results) {
            outputs.set(result.agentId, result);
          }
        } else {
          const result = await this.executeStep(stage, outputs, trigger);
          outputs.set(result.agentId, result);
        }

        emitProgress({
          workflowId,
          stage: 'stage_complete',
          stageIndex,
          totalStages,
          agentIds,
          timestamp: new Date().toISOString(),
        });

        // Run after-stage hook if registered
        const hook = workflow.afterStageHooks?.get(stageIndex);
        if (hook) {
          await hook();
        }
        stageIndex++;
      }

      logger.info(`Workflow complete: ${workflow.name}`, {
        workflowId,
        agentsRun: [...outputs.keys()],
      });

      emitProgress({ workflowId, stage: 'complete', totalStages, timestamp: new Date().toISOString() });

      return outputs;
    } catch (err) {
      emitProgress({
        workflowId,
        stage: 'error',
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      });
      throw err;
    }
  }

  private async executeStep(
    step: WorkflowStep,
    previousOutputs: Map<string, AgentStepResult>,
    trigger: { message?: string; sessionKey?: string },
    parallel = false,
  ): Promise<AgentStepResult> {
    const message = step.buildMessage(previousOutputs, trigger.message);

    return this.runtime.run({
      agentId: step.agentId,
      message,
      // Parallel steps must not share a session — concurrent appends would interleave writes.
      sessionKey: parallel ? undefined : trigger.sessionKey,
    });
  }
}

export function registerBuiltinWorkflows(
  orchestrator: Orchestrator,
  options?: { reflectionEngine?: ReflectionEngine; insightStore?: InsightStore },
): void {
  const afterStageHooks = new Map<number, () => Promise<void>>();

  if (options?.reflectionEngine) {
    const engine = options.reflectionEngine;
    afterStageHooks.set(0, async () => {
      // Fire-and-forget: don't block the workflow pipeline
      engine
        .runSweep({ olderThanDays: 7 })
        .then((result) => {
          logger.info('Post-scrape reflection sweep', { ...result });
        })
        .catch((err) => {
          logger.warn('Reflection sweep failed', { error: err });
        });
    });
  }

  orchestrator.register({
    id: 'morning-digest',
    name: 'Morning Digest',
    afterStageHooks: afterStageHooks.size > 0 ? afterStageHooks : undefined,
    stages: [
      {
        agentId: 'trader',
        buildMessage: () => 'Scrape current positions from all connected platforms.',
      },
      [
        {
          agentId: 'research-analyst',
          buildMessage: (prev) =>
            `Enrich these positions with latest market data:\n\n${prev.get('trader')?.text ?? 'No positions available.'}`,
        },
        {
          agentId: 'risk-manager',
          buildMessage: (prev) =>
            `Analyze portfolio risk for these positions:\n\n${prev.get('trader')?.text ?? 'No positions available.'}`,
        },
      ],
      {
        agentId: 'strategist',
        buildMessage: (prev) =>
          `Create a morning digest.\n\nResearch:\n${prev.get('research-analyst')?.text ?? ''}\n\nRisk:\n${prev.get('risk-manager')?.text ?? ''}`,
      },
    ],
  });

  orchestrator.register({
    id: 'analyze-symbol',
    name: 'Analyze Symbol',
    stages: [
      {
        agentId: 'research-analyst',
        buildMessage: (_prev, trigger) =>
          `Analyze: ${trigger ?? 'the requested symbol'} — fundamentals, technicals, news, sentiment.`,
      },
      {
        agentId: 'risk-manager',
        buildMessage: (prev, trigger) =>
          `Check exposure and risk for ${trigger ?? 'this symbol'}:\n\n${prev.get('research-analyst')?.text ?? ''}`,
      },
      {
        agentId: 'strategist',
        buildMessage: (prev) =>
          `Based on research and risk analysis, what is your recommendation?\n\nResearch:\n${prev.get('research-analyst')?.text ?? ''}\n\nRisk:\n${prev.get('risk-manager')?.text ?? ''}`,
      },
    ],
  });

  orchestrator.register({
    id: 'recommend',
    name: 'Portfolio Recommendation',
    stages: [
      {
        agentId: 'research-analyst',
        buildMessage: () => 'Enrich the full portfolio with latest data.',
      },
      {
        agentId: 'risk-manager',
        buildMessage: (prev) => `Full risk report based on:\n\n${prev.get('research-analyst')?.text ?? ''}`,
      },
      {
        agentId: 'strategist',
        buildMessage: (prev) =>
          `Based on your persona, research, and risk — should the user act?\n\nResearch:\n${prev.get('research-analyst')?.text ?? ''}\n\nRisk:\n${prev.get('risk-manager')?.text ?? ''}`,
      },
    ],
  });

  // Process Insights workflow (requires insightStore)
  if (options?.insightStore) {
    registerProcessInsightsWorkflow(orchestrator, { insightStore: options.insightStore });
  }
}
