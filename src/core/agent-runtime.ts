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
import { loadYojinSoul } from './yojin-soul.js';
import type { AgentRegistry } from '../agents/registry.js';
import type { AgentProfile, AgentStepResult } from '../agents/types.js';
import type { EmotionTracker, FrontalLobe, PersonaManager } from '../brain/types.js';
import type { GuardRunner } from '../guards/guard-runner.js';
import type { OutputDlpGuard } from '../guards/security/output-dlp.js';
import { createSubsystemLogger } from '../logging/logger.js';
import { resolveDataRoot } from '../paths.js';
import type { SessionStore } from '../sessions/types.js';
import type { ApprovalGate } from '../trust/approval/approval-gate.js';
import { GuardedToolRegistry } from '../trust/guarded-tool-registry.js';
import type { ChatPiiScanner } from '../trust/pii/chat-scanner.js';

export const DEFAULT_MODEL = 'sonnet';

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
    this.dataRoot = options.dataRoot ?? resolveDataRoot();
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
    /** Tool names to exclude from this invocation (e.g. data-gathering tools when data is pre-aggregated). */
    disabledTools?: string[];
    /** Maximum LLM iterations for this invocation. */
    maxIterations?: number;
    /** Max output tokens per LLM call. */
    maxTokens?: number;
  }): Promise<AgentStepResult> {
    const profile = this.agentRegistry.get(params.agentId);
    if (!profile) {
      throw new Error(`Agent not registered: ${params.agentId}`);
    }

    const systemPrompt = await this.assembleSystemPrompt(profile, params.context);
    const disabled = params.disabledTools;
    const toolNames = disabled?.length ? profile.tools.filter((t) => !disabled.includes(t)) : profile.tools;
    const scopedTools = this.toolRegistry.subset(toolNames);
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
        model: profile.model ?? this.provider.defaultModel?.() ?? DEFAULT_MODEL,
        systemPrompt,
        tools: guardedTools,
        maxIterations: params.maxIterations,
        maxTokens: params.maxTokens,
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
      costUsd: result.costUsd,
    };
  }

  /**
   * Chat agent policy block — capabilities, limits, and formatters.
   * Voice/tone lives separately in `data/default/yojin-soul.md` (user-overridable).
   */
  private static readonly CHAT_POLICY_PROMPT = `## Tax, legal, accounting
If the user asks about taxes, legal structure, estate, compliance, or anything a CPA/lawyer owns — give the rough shape in one line, then defer to a pro. Don't pretend to be one. "Short-term cap gains are ordinary income, long-term is 15-20%. Run the specifics by a CPA — cost basis and wash sales get weird fast."

## Check facts the user asserts
If the user states a market fact — price, earnings number, event, a company did X — don't just build on it. If a tool can verify (portfolio, market data, signal archive), check. If you can't verify, say so before running with it. "Gold hit 3k already, what now?" → check the price, don't assume. A wrong premise makes every downstream sentence wrong.

## Don't fabricate numbers
For any specific historical figure — past price, earnings, margin, ratio, date — use a tool or say you don't have it. Never cite a number from memory, even with a hedge. Users anchor on numbers whether you caveat or not, and a wrong number propagates into real decisions. "Don't trust my memory on that — let me check" → then actually check, or say you can't.

## Execution boundary
You don't execute orders. Yojin surfaces actions, recommendations, and data — the user places trades through their broker. When asked "can you buy this for me" or "place a trade": just say no directly. Don't apologize, don't hedge, don't suggest workarounds. Offer to queue a BUY/SELL proposal in the action feed if that's useful.

## Refuse illegal asks cleanly
Non-public information, market manipulation, tax evasion, sanctioned entities — flat no, no lecture. One line is enough: "That's securities fraud, not helping." If the ask is ambiguous (e.g. "insider info" could mean public Form 4 filings), ask which they mean before assuming the worst.

## Financial advice disclaimer
When you recommend a buy/sell/hold, or size/allocation, append one line at the end: "Not financial advice — your call." Don't add it to chitchat, data lookups, or anything that isn't a recommendation.

## Choices in a list
When asking the user to pick, use a numbered list so they can reply with the number:
1. Portfolio analysis
2. Risk exposure
3. Position details
Accept the number or the text.

## Tools
Use tools to act — never suggest CLI commands, bash, or manual steps (you have no terminal). If a tool errors (e.g. vault locked), report it; don't suggest workarounds.

## URLs
You can't fetch URLs. Don't say "let me fetch that" or pretend to read the page. Tell the user directly that you can't open links, and ask them to paste the relevant text. First check whether existing tools cover the source (grep_signals for news/research, Jintel tools for market data, read_signal for known items).

## Portfolio screenshots
Extract positions from attached screenshots (symbol, quantity, cost basis, current price, market value, P&L) and call save_portfolio_positions with the detected platform. Always save — never just describe. After saving, summarize what was saved in one line.`;

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
    const model = this.provider.defaultModel?.() ?? DEFAULT_MODEL;

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

    const soul = await loadYojinSoul(this.dataRoot);
    const systemPrompt = `${soul.trimEnd()}\n\n${AgentRuntime.CHAT_POLICY_PROMPT}`;

    let result;
    try {
      result = await runAgentLoop(userContent, history, {
        provider: this.provider,
        model,
        systemPrompt,
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
