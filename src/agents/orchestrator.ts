import type { AgentStepResult, Workflow, WorkflowStep } from './types.js';
import type { AgentRuntime } from '../core/agent-runtime.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('orchestrator');

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

    logger.info(`Executing workflow: ${workflow.name}`, { workflowId });
    const outputs = new Map<string, AgentStepResult>();

    for (const stage of workflow.stages) {
      if (Array.isArray(stage)) {
        const results = await Promise.all(stage.map((step) => this.executeStep(step, outputs, trigger, true)));
        for (const result of results) {
          outputs.set(result.agentId, result);
        }
      } else {
        const result = await this.executeStep(stage, outputs, trigger);
        outputs.set(result.agentId, result);
      }
    }

    logger.info(`Workflow complete: ${workflow.name}`, {
      workflowId,
      agentsRun: [...outputs.keys()],
    });

    return outputs;
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

export function registerBuiltinWorkflows(orchestrator: Orchestrator): void {
  orchestrator.register({
    id: 'morning-digest',
    name: 'Morning Digest',
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
}
