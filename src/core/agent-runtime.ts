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
import type {
  AgentLoopEventHandler,
  AgentLoopProvider,
  AgentMessage,
  ImageMediaType,
  ToolDefinition,
} from './types.js';
import type { AgentRegistry } from '../agents/registry.js';
import type { AgentProfile, AgentStepResult } from '../agents/types.js';
import type { EmotionTracker, FrontalLobe, PersonaManager } from '../brain/types.js';
import type { GuardRunner } from '../guards/guard-runner.js';
import type { OutputDlpGuard } from '../guards/security/output-dlp.js';
import { createSubsystemLogger } from '../logging/logger.js';
import type { SessionStore } from '../sessions/types.js';
import type { ApprovalGate } from '../trust/approval/approval-gate.js';
import { GuardedToolRegistry } from '../trust/guarded-tool-registry.js';
import type { ChatPiiScanner } from '../trust/pii/chat-scanner.js';

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
  piiScanner?: ChatPiiScanner;
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
  private readonly piiScanner?: ChatPiiScanner;

  constructor(options: AgentRuntimeOptions) {
    this.agentRegistry = options.agentRegistry;
    this.toolRegistry = options.toolRegistry;
    this.sessionStore = options.sessionStore;
    this.eventLog = options.eventLog;
    this.provider = options.provider;
    this.dataRoot = options.dataRoot ?? '.';
    this.brain = options.brain;
    this.piiScanner = options.piiScanner;
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
    abortSignal?: AbortSignal;
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
        abortSignal: params.abortSignal,
        piiScanner: this.piiScanner,
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

  /** General-purpose chat system prompt — same as the CLI REPL. */
  private static readonly CHAT_SYSTEM_PROMPT =
    'You are Yojin, a personal AI finance agent. ' +
    'CRITICAL: You MUST use your tools to perform actions. NEVER suggest CLI commands, bash snippets, or manual steps. ' +
    'You do NOT have access to a terminal — you can ONLY act through tool calls. ' +
    'When the user asks to store a credential, call store_credential. When they ask to check something, call the relevant tool. ' +
    'If a tool returns an error (e.g. vault locked), report the error — do not suggest workarounds the user should run manually. ' +
    'You can see images that users attach to their messages. When a user sends an image (e.g. a portfolio screenshot), ' +
    'analyze it directly — describe what you see, extract any visible data, and respond accordingly.';

  async handleMessage(params: {
    message: string;
    channelId: string;
    userId: string;
    threadId?: string;
    onEvent?: AgentLoopEventHandler;
    /** Optional base64-encoded image to include with the message. */
    imageBase64?: string;
    /** MIME type of the image (required when imageBase64 is provided). */
    imageMediaType?: ImageMediaType;
    abortSignal?: AbortSignal;
  }): Promise<string> {
    const model = DEFAULT_MODEL;

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

    // Use all available tools (same as CLI chat) — not scoped to a single agent.
    const allTools = this.toolRegistry.all();
    const guardedTools = this.wrapToolsWithGuards(allTools, 'chat');

    const history = sessionKey ? (await this.sessionStore.getHistory(sessionKey)).map((e) => e.message) : [];

    await this.eventLog.append({
      type: 'agent.run.start',
      data: { agentId: 'chat', sessionKey: sessionKey ?? null },
    });

    // Build user message — text-only or mixed content with image
    const userContent: string | import('./types.js').ContentBlock[] =
      params.imageBase64 && params.imageMediaType
        ? [
            {
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: params.imageMediaType, data: params.imageBase64 },
            },
            { type: 'text' as const, text: params.message },
          ]
        : params.message;

    let result;
    try {
      result = await runAgentLoop(userContent, history, {
        provider: this.provider,
        model,
        systemPrompt: AgentRuntime.CHAT_SYSTEM_PROMPT,
        tools: guardedTools,
        onEvent: params.onEvent,
        abortSignal: params.abortSignal,
        piiScanner: this.piiScanner,
      });
    } catch (err) {
      await this.eventLog.append({
        type: 'agent.run.error',
        data: { agentId: 'chat', error: String(err) },
      });
      throw err;
    }

    if (sessionKey) {
      for (const msg of result.messages.slice(history.length)) {
        // Strip base64 image data before persisting — re-sending full images
        // on every subsequent turn would exhaust the context window and bloat storage.
        await this.sessionStore.append(sessionKey, AgentRuntime.stripImageData(msg));
      }
    }

    await this.eventLog.append({
      type: 'agent.run.complete',
      data: { agentId: 'chat', iterations: result.iterations, usage: result.usage },
    });

    logger.info('Chat completed', {
      iterations: result.iterations,
      usage: result.usage,
    });

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

  /**
   * Replace ImageBlock entries with a lightweight text stub so we don't
   * persist (and re-send) large base64 payloads in session history.
   */
  private static stripImageData(msg: AgentMessage): AgentMessage {
    if (typeof msg.content === 'string') return msg;
    const stripped = msg.content.map((block) => {
      if (block.type === 'image') {
        return { type: 'text' as const, text: '[Image attached]' };
      }
      return block;
    });
    return { ...msg, content: stripped };
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
