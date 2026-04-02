/**
 * AgentLoop — the core Thought → Action → Observation cycle.
 *
 * 1. Send conversation + tool schemas to the LLM
 * 2. If the LLM returns tool_use blocks → execute via ToolRegistry → append results → loop
 * 3. If the LLM returns end_turn (text only, no tool calls) → return final response
 *
 * Memory management:
 * - Token budget tracking detects when approaching context window limit
 * - Snip pass strips verbose tool results from older messages before LLM summarization
 * - Tool results are truncated (head+tail) before entering history
 * - Context compaction summarizes older messages, preserving recent turns
 *
 * Streaming tool execution:
 * - When provider supports onToolUse callback, tools start executing during the stream
 * - Overlaps tool execution with the remainder of the LLM response
 *
 * Cost tracking:
 * - Optional CostTracker records per-model USD cost
 * - Budget enforcement stops the loop when cost cap is exceeded
 */

import { compactMessages } from './context-compaction.js';
import { snipToolResults } from './snip.js';
import { StreamingToolExecutor } from './streaming-tool-executor.js';
import { TokenBudget } from './token-budget.js';
import { ToolRegistry } from './tool-registry.js';
import { truncateToolResult } from './tool-result-truncation.js';
import type {
  AgentLoopEvent,
  AgentLoopOptions,
  AgentMessage,
  ContentBlock,
  TextBlock,
  ToolCall,
  ToolCallResult,
  ToolResultBlock,
  ToolUseBlock,
} from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('agent-loop');

const DEFAULT_MAX_ITERATIONS = 20;
const LLM_TIMEOUT_MS = 120_000;

export interface AgentLoopResult {
  /** Final text response from the agent. */
  text: string;
  /** Full conversation history including tool calls. */
  messages: AgentMessage[];
  /** Number of TAO iterations performed. */
  iterations: number;
  /** Total usage across all iterations. */
  usage: { inputTokens: number; outputTokens: number };
  /** Number of compactions performed during this run. */
  compactions: number;
  /** Total estimated cost in USD for this run. */
  costUsd?: number;
}

export async function runAgentLoop(
  userMessage: string | ContentBlock[],
  history: AgentMessage[],
  options: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const {
    provider,
    model,
    systemPrompt,
    tools = [],
    maxIterations = DEFAULT_MAX_ITERATIONS,
    memory,
    onEvent,
    agentId,
    abortSignal,
    piiScanner,
    costTracker,
  } = options;

  logger.info('Agent loop started', {
    agentId,
    model,
    maxIterations,
    toolCount: tools.length,
  });

  const registry = new ToolRegistry();
  for (const tool of tools) {
    registry.register(tool);
  }

  const budget = new TokenBudget({
    contextWindow: memory?.contextWindow,
    compactionThreshold: memory?.compactionThreshold,
    maxToolResultShare: memory?.maxToolResultShare,
  });

  const maxToolResultChars = memory?.maxToolResultChars ?? budget.maxToolResultChars();

  const toolSchemas = registry.toSchemas();

  // ── PII: scrub sensitive data from user message before LLM ──────
  const piiResult = piiScanner ? await scrubUserMessage(piiScanner, userMessage) : undefined;
  const messageContentForLlm = piiResult?.content ?? userMessage;
  const piiMap = piiResult?.piiMap;
  if (piiResult?.event) {
    emit(onEvent, piiResult.event);
  }

  // Send scrubbed text to LLM, but keep original in history for future turns
  let messages: AgentMessage[] = [...history, { role: 'user', content: messageContentForLlm }];
  const originalUserIdx = messages.length - 1;
  const totalUsage = { inputTokens: 0, outputTokens: 0 };
  let compactions = 0;

  let iterations = 0;

  while (iterations < maxIterations) {
    iterations++;

    logger.debug('TAO iteration', { agentId, iteration: iterations, messageCount: messages.length });

    // Check abort signal between iterations
    if (abortSignal?.aborted) {
      logger.warn('Agent loop aborted', { agentId, iteration: iterations });
      const lastAssistant = messages.filter((m) => m.role === 'assistant').pop();
      const fallbackText = extractText(lastAssistant);
      emit(onEvent, { type: 'done', text: fallbackText, iterations });
      return {
        text: fallbackText,
        messages,
        iterations,
        usage: totalUsage,
        compactions,
        costUsd: costTracker?.snapshot().totalCostUsd,
      };
    }

    // ── Budget check: stop if cost cap exceeded ──────────────────────
    if (costTracker?.isOverBudget()) {
      const snap = costTracker.snapshot();
      logger.warn('Budget exceeded, stopping agent loop', {
        agentId,
        totalCostUsd: snap.totalCostUsd,
      });
      emit(onEvent, {
        type: 'budget_exceeded',
        totalCostUsd: snap.totalCostUsd,
        budgetUsd: costTracker.maxRunBudgetUsd ?? snap.totalCostUsd,
      });
      const lastAssistant = messages.filter((m) => m.role === 'assistant').pop();
      const fallbackText = extractText(lastAssistant) || 'I stopped because the cost budget was exceeded.';
      emit(onEvent, { type: 'done', text: fallbackText, iterations });
      return { text: fallbackText, messages, iterations, usage: totalUsage, compactions, costUsd: snap.totalCostUsd };
    }

    // ── Memory: snip verbose tool results before checking compaction ─
    const snipResult = snipToolResults(messages, budget, {
      preserveRecentTurns: memory?.preserveRecentTurns ?? 5,
    });
    if (snipResult.snipped > 0) {
      messages = snipResult.messages;
      emit(onEvent, {
        type: 'snip',
        messagesBefore: snipResult.messagesBefore,
        messagesAfter: snipResult.messages.length,
        toolResultsSnipped: snipResult.snipped,
      });
    }

    // ── Memory: check if compaction is needed ───────────────────────
    if (budget.shouldCompact(messages, systemPrompt)) {
      const result = await compactMessages(messages, provider, model, budget, {
        preserveRecentTurns: memory?.preserveRecentTurns ?? 5,
      });
      if (result.messagesAfter < result.messagesBefore) {
        messages = result.messages;
        compactions++;
        emit(onEvent, {
          type: 'compaction',
          messagesBefore: result.messagesBefore,
          messagesAfter: result.messagesAfter,
          usedLlmSummary: result.usedLlmSummary,
        });
      }
    }

    // ── Thought: ask the LLM (streaming with tool execution) ─────────
    const maxTokens = options.maxTokens;
    let response;

    // Set up streaming tool executor for overlapping execution
    const streamingExecutor = new StreamingToolExecutor(registry, agentId);

    try {
      const llmCall = provider.streamWithTools
        ? provider.streamWithTools({
            model,
            system: systemPrompt,
            messages,
            tools: toolSchemas.length > 0 ? toolSchemas : undefined,
            ...(maxTokens ? { maxTokens } : {}),
            onTextDelta: (text) => emit(onEvent, { type: 'text_delta', text }),
            onToolUse: (block) => {
              // Start executing the tool immediately while the stream continues
              emit(onEvent, { type: 'tool_started', toolCallId: block.id, toolName: block.name });
              streamingExecutor.addToolCall({ id: block.id, name: block.name, input: block.input });
            },
          })
        : provider.completeWithTools({
            model,
            system: systemPrompt,
            messages,
            tools: toolSchemas.length > 0 ? toolSchemas : undefined,
            ...(maxTokens ? { maxTokens } : {}),
          });

      let timer: ReturnType<typeof setTimeout> | undefined;
      response = await Promise.race([
        llmCall.then((r) => {
          clearTimeout(timer);
          return r;
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('LLM request timed out')), LLM_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('LLM call failed', { agentId, iteration: iterations, error: errMsg });
      emit(onEvent, { type: 'error', error: errMsg, iterations });
      throw err;
    }

    if (response.usage) {
      totalUsage.inputTokens += response.usage.inputTokens;
      totalUsage.outputTokens += response.usage.outputTokens;

      // Track cost
      if (costTracker) {
        const cost = costTracker.addUsage(model, {
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
        });
        emit(onEvent, {
          type: 'cost',
          model,
          costUsd: cost,
          totalCostUsd: costTracker.snapshot().totalCostUsd,
        });
      }

      logger.debug('LLM response received', {
        agentId,
        iteration: iterations,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
      });
    }

    // Extract text and tool_use blocks from the response
    const textBlocks = response.content.filter((b): b is TextBlock => b.type === 'text');
    const toolUseBlocks = response.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
    const thoughtText = textBlocks.map((b) => b.text).join('');

    if (thoughtText) {
      emit(onEvent, { type: 'thought', text: thoughtText });
    }

    // No tool calls → done
    if (toolUseBlocks.length === 0) {
      logger.info('Agent loop completed', {
        agentId,
        iterations,
        totalInputTokens: totalUsage.inputTokens,
        totalOutputTokens: totalUsage.outputTokens,
        compactions,
        costUsd: costTracker?.snapshot().totalCostUsd,
      });
      // Rehydrate PII tags in the final response so the user sees original values
      const finalText = piiScanner && piiMap ? await piiScanner.restore(thoughtText, piiMap) : thoughtText;
      emit(onEvent, { type: 'done', text: finalText, iterations });
      messages.push({ role: 'assistant', content: response.content });
      // Restore original user message in history so future turns don't see stale PII tags
      if (piiMap) {
        messages[originalUserIdx] = { role: 'user', content: userMessage };
      }
      return {
        text: finalText,
        messages,
        iterations,
        usage: totalUsage,
        compactions,
        costUsd: costTracker?.snapshot().totalCostUsd,
      };
    }

    // ── Action: execute tool calls ────────────────────────────────────
    const toolCalls: ToolCall[] = toolUseBlocks.map((b) => ({
      id: b.id,
      name: b.name,
      input: b.input,
    }));
    logger.debug('Executing tool calls', {
      agentId,
      iteration: iterations,
      tools: toolCalls.map((c) => c.name),
    });
    emit(onEvent, { type: 'action', toolCalls });

    // Append assistant message with tool_use blocks
    messages.push({ role: 'assistant', content: response.content });

    // Submit any tool calls that weren't already started during streaming.
    // Check BEFORE the loop — once we addToolCall, pendingCount changes.
    const streamingWasActive = streamingExecutor.pendingCount > 0 || streamingExecutor.getCompletedResults().length > 0;

    if (!streamingWasActive) {
      // Non-streaming provider: submit all tools now
      for (const call of toolCalls) {
        streamingExecutor.addToolCall(call);
      }
    } else {
      // Streaming was active — only submit tools that weren't already started
      const startedIds = new Set(streamingExecutor.getCompletedResults().map((r) => r.toolCallId));
      for (const call of toolCalls) {
        if (!startedIds.has(call.id)) {
          streamingExecutor.addToolCall(call);
        }
      }
    }

    // Wait for all tools to complete
    const results: ToolCallResult[] = await streamingExecutor.awaitAll();

    // ── Truncate oversized tool results ───────────────────────────────
    for (const entry of results) {
      const originalLength = entry.result.content.length;
      const { content, wasTruncated } = truncateToolResult(entry.result.content, {
        maxChars: maxToolResultChars,
      });
      if (wasTruncated) {
        entry.result.content = content;
        emit(onEvent, {
          type: 'tool_result_truncated',
          toolName: entry.name,
          originalChars: originalLength,
          truncatedChars: content.length,
        });
      }
    }

    // ── Observation: feed results back ────────────────────────────────
    emit(onEvent, { type: 'observation', results });

    const toolResultBlocks: ToolResultBlock[] = results.map((r) => ({
      type: 'tool_result' as const,
      tool_use_id: r.toolCallId,
      content: r.result.content,
      is_error: r.result.isError,
    }));

    messages.push({ role: 'user', content: toolResultBlocks });
  }

  // Max iterations reached
  logger.warn('Agent loop hit max iterations', {
    agentId,
    maxIterations,
    totalInputTokens: totalUsage.inputTokens,
    totalOutputTokens: totalUsage.outputTokens,
  });
  emit(onEvent, { type: 'max_iterations', iterations });
  if (piiMap) {
    messages[originalUserIdx] = { role: 'user', content: userMessage };
  }
  const lastAssistant = messages.filter((m) => m.role === 'assistant').pop();
  const fallbackText = extractText(lastAssistant);
  return {
    text: fallbackText || 'I reached the maximum number of steps. Please try again with a simpler request.',
    messages,
    iterations,
    usage: totalUsage,
    compactions,
    costUsd: costTracker?.snapshot().totalCostUsd,
  };
}

function emit(handler: ((e: AgentLoopEvent) => void) | undefined, event: AgentLoopEvent): void {
  if (handler) handler(event);
}

function extractText(message: AgentMessage | undefined): string {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/** Scrub PII from user messages before sending to LLM. */
async function scrubUserMessage(
  piiScanner: import('../trust/pii/chat-scanner.js').ChatPiiScanner,
  userMessage: string | ContentBlock[],
): Promise<
  { content: string | ContentBlock[]; piiMap?: import('rehydra').EncryptedPIIMap; event: AgentLoopEvent } | undefined
> {
  if (typeof userMessage === 'string') {
    const result = await piiScanner.scrub(userMessage);
    if (result.entitiesFound === 0) return undefined;
    return {
      content: result.sanitized,
      piiMap: result.piiMap,
      event: {
        type: 'pii_redacted',
        entitiesFound: result.entitiesFound,
        typesFound: result.typesFound,
        processingTimeMs: result.processingTimeMs,
      },
    };
  }

  // ContentBlock[] — scan only text blocks
  const textParts = userMessage.filter((b) => b.type === 'text').map((b) => (b as TextBlock).text);
  if (textParts.length === 0) return undefined;

  const combined = textParts.join('\n');
  const result = await piiScanner.scrub(combined);
  if (result.entitiesFound === 0) return undefined;

  let scrubOffset = 0;
  const scrubbed = result.sanitized;
  const content = userMessage.map((b) => {
    if (b.type !== 'text') return b;
    const original = (b as TextBlock).text;
    const end = scrubOffset + original.length;
    const replacement = scrubbed.slice(scrubOffset, end);
    scrubOffset = end + 1; // +1 for the \n separator
    return { type: 'text' as const, text: replacement };
  });

  return {
    content,
    piiMap: result.piiMap,
    event: {
      type: 'pii_redacted',
      entitiesFound: result.entitiesFound,
      typesFound: result.typesFound,
      processingTimeMs: result.processingTimeMs,
    },
  };
}
