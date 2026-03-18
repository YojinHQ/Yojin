/**
 * AgentRuntime — the top-level coordinator for running agents.
 *
 * Responsibilities:
 * 1. Look up agent profile from AgentRegistry
 * 2. Assemble system prompt (with Brain state for Strategist)
 * 3. Scope tools to agent profile and wrap with guard pipeline
 * 4. Load/persist session history
 * 5. Delegate to runAgentLoop for the actual TAO cycle
 */

import { runAgentLoop } from './agent-loop.js';
import type { EventLog } from './event-log.js';
import type { ToolRegistry } from './tool-registry.js';
import type { AgentLoopEventHandler, AgentLoopProvider, ToolDefinition } from './types.js';
import type { AgentRegistry } from '../agents/registry.js';
import type { AgentProfile, AgentStepResult } from '../agents/types.js';
import type { EmotionTracker, FrontalLobe, PersonaManager } from '../brain/types.js';
import type { GuardRunner } from '../guards/guard-runner.js';
import type { OutputDlpGuard } from '../guards/security/output-dlp.js';
import { createSubsystemLogger } from '../logging/logger.js';
import type { SessionStore } from '../sessions/types.js';
import type { ApprovalGate } from '../trust/approval/approval-gate.js';
import { GuardedToolRegistry } from '../trust/guarded-tool-registry.js';

const DEFAULT_MODEL = 'claude-opus-4-6';

const logger = createSubsystemLogger('agent-runtime');

export interface AgentRuntimeOptions {
  agentRegistry: AgentRegistry;
  toolRegistry: ToolRegistry;
  guardRunner: GuardRunner;
  sessionStore: SessionStore;
  eventLog: EventLog;
  provider: AgentLoopProvider;
  approvalGate?: ApprovalGate;
  outputDlp?: OutputDlpGuard;
  dataRoot?: string;
  brain?: {
    persona: PersonaManager;
    frontalLobe: FrontalLobe;
    emotion: EmotionTracker;
  };
}

export class AgentRuntime {
  private readonly agentRegistry: AgentRegistry;
  private readonly toolRegistry: ToolRegistry;
  private readonly sessionStore: SessionStore;
  private readonly eventLog: EventLog;
  private readonly provider: AgentLoopProvider;
  private readonly guardedRegistry: GuardedToolRegistry;
  private readonly dataRoot: string;
  private readonly brain?: AgentRuntimeOptions['brain'];

  constructor(options: AgentRuntimeOptions) {
    this.agentRegistry = options.agentRegistry;
    this.toolRegistry = options.toolRegistry;
    this.sessionStore = options.sessionStore;
    this.eventLog = options.eventLog;
    this.provider = options.provider;
    this.dataRoot = options.dataRoot ?? '.';
    this.brain = options.brain;
    this.guardedRegistry = new GuardedToolRegistry({
      registry: options.toolRegistry,
      guardRunner: options.guardRunner,
      approvalGate: options.approvalGate,
      outputDlp: options.outputDlp,
    });
  }

  async run(params: {
    agentId: string;
    message: string;
    sessionKey?: string;
    context?: string;
    onEvent?: AgentLoopEventHandler;
  }): Promise<AgentStepResult> {
    const profile = this.agentRegistry.get(params.agentId);
    if (!profile) {
      throw new Error(`Agent not registered: ${params.agentId}`);
    }

    const systemPrompt = await this.assembleSystemPrompt(profile, params.context);
    const scopedTools = this.toolRegistry.subset(profile.tools);
    const guardedTools = this.wrapToolsWithGuards(scopedTools, params.agentId);

    const history = params.sessionKey
      ? (await this.sessionStore.getHistory(params.sessionKey)).map((e) => e.message)
      : [];

    await this.eventLog.append({
      type: 'agent.run.start',
      data: { agentId: params.agentId, sessionKey: params.sessionKey ?? null },
    });

    let result;
    try {
      result = await runAgentLoop(params.message, history, {
        provider: this.provider,
        model: profile.model ?? DEFAULT_MODEL,
        systemPrompt,
        tools: guardedTools,
        onEvent: params.onEvent,
      });
    } catch (err) {
      await this.eventLog.append({
        type: 'agent.run.error',
        data: { agentId: params.agentId, error: String(err) },
      });
      throw err;
    }

    if (params.sessionKey) {
      for (const msg of result.messages.slice(history.length)) {
        await this.sessionStore.append(params.sessionKey, msg);
      }
    }

    await this.eventLog.append({
      type: 'agent.run.complete',
      data: { agentId: params.agentId, iterations: result.iterations, usage: result.usage },
    });

    logger.info(`Agent ${params.agentId} completed`, {
      iterations: result.iterations,
      usage: result.usage,
    });

    return {
      agentId: params.agentId,
      text: result.text,
      messages: result.messages,
      iterations: result.iterations,
      usage: result.usage,
      compactions: result.compactions,
    };
  }

  async handleMessage(params: {
    message: string;
    channelId: string;
    userId: string;
    threadId?: string;
  }): Promise<string> {
    const agentId: string = 'strategist';

    const profile = this.agentRegistry.get(agentId);
    const model = profile?.model ?? DEFAULT_MODEL;

    let sessionKey: string | undefined;
    if (params.threadId) {
      const existing = await this.sessionStore.getByThread(params.channelId, params.threadId);
      if (existing) {
        sessionKey = existing.id;
      } else {
        const session = await this.sessionStore.create({
          channelId: params.channelId,
          threadId: params.threadId,
          userId: params.userId,
          providerId: 'agent-runtime',
          model,
        });
        sessionKey = session.id;
      }
    }

    const result = await this.run({ agentId, message: params.message, sessionKey });
    return result.text;
  }

  private wrapToolsWithGuards(tools: ToolDefinition[], agentId: string): ToolDefinition[] {
    return tools.map((tool) => ({
      ...tool,
      execute: async (params: unknown) => {
        return this.guardedRegistry.execute(tool.name, params, { agentId });
      },
    }));
  }

  private async assembleSystemPrompt(profile: AgentProfile, additionalContext?: string): Promise<string> {
    const loaded = await this.agentRegistry.loadProfile(profile.id, this.dataRoot);
    let prompt = loaded.systemPrompt;

    if (profile.id === 'strategist' && this.brain) {
      const [persona, frontalLobe, emotion] = await Promise.all([
        this.brain.persona.getPersona(),
        this.brain.frontalLobe.get(),
        this.brain.emotion.getEmotion(),
      ]);

      prompt += `\n\n---\n\n## Persona\n\n${persona}`;
      prompt += `\n\n## Working Memory\n\n${frontalLobe}`;
      prompt += `\n\n## Emotional State\n\nConfidence: ${emotion.confidence}, Risk Appetite: ${emotion.riskAppetite}\nReason: ${emotion.reason}`;
    }

    if (additionalContext) {
      prompt += `\n\n---\n\n## Context from Previous Agents\n\n${additionalContext}`;
    }

    return prompt;
  }
}
