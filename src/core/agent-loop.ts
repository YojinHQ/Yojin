/**
 * AgentLoop — the core Thought → Action → Observation cycle.
 *
 * 1. Send conversation + tool schemas to the LLM
 * 2. If the LLM returns tool_use blocks → execute via ToolRegistry → append results → loop
 * 3. If the LLM returns end_turn (text only, no tool calls) → return final response
 *
 * Memory management:
 * - Token budget tracking detects when approaching context window limit
 * - Tool results are truncated (head+tail) before entering history
 * - Context compaction summarizes older messages, preserving recent turns
 */

import { compactMessages } from './context-compaction.js';
import { TokenBudget } from './token-budget.js';
import { ToolRegistry } from './tool-registry.js';
import { truncateToolResult } from './tool-result-truncation.js';
import type {
  AgentLoopEvent,
  AgentLoopOptions,
  AgentMessage,
  TextBlock,
  ToolCall,
  ToolCallResult,
  ToolExecutor,
  ToolResultBlock,
  ToolUseBlock,
} from './types.js';
import { GuardedToolRegistry } from '../trust/guarded-tool-registry.js';

const DEFAULT_MAX_ITERATIONS = 20;

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
}

export async function runAgentLoop(
  userMessage: string,
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
    guardRunner,
    outputDlp,
    approvalGate,
    agentId,
    abortSignal,
    piiScanner,
  } = options;

  const registry = new ToolRegistry();
  for (const tool of tools) {
    registry.register(tool);
  }

  // Fail fast if outputDlp or approvalGate provided without guardRunner
  if ((outputDlp || approvalGate) && !guardRunner) {
    throw new Error('outputDlp and approvalGate require guardRunner to be provided');
  }

  // Wrap with guard pipeline when guardRunner is provided
  const executor: ToolExecutor = guardRunner
    ? new GuardedToolRegistry({ registry, guardRunner, outputDlp, approvalGate })
    : registry;

  const budget = new TokenBudget({
    contextWindow: memory?.contextWindow,
    compactionThreshold: memory?.compactionThreshold,
    maxToolResultShare: memory?.maxToolResultShare,
  });

  const maxToolResultChars = memory?.maxToolResultChars ?? budget.maxToolResultChars();

  const toolSchemas = registry.toSchemas();

  // ── PII: scrub sensitive data from user message before LLM ──────
  let messageForLlm = userMessage;
  let piiMap: import('rehydra').EncryptedPIIMap | undefined;

  if (piiScanner) {
    const scrubResult = await piiScanner.scrub(userMessage);
    if (scrubResult.entitiesFound > 0) {
      messageForLlm = scrubResult.sanitized;
      piiMap = scrubResult.piiMap;
      emit(onEvent, {
        type: 'pii_redacted',
        entitiesFound: scrubResult.entitiesFound,
        typesFound: scrubResult.typesFound,
        processingTimeMs: scrubResult.processingTimeMs,
      });
    }
  }

  // Send scrubbed text to LLM, but keep original in history for future turns
  let messages: AgentMessage[] = [...history, { role: 'user', content: messageForLlm }];
  const originalUserIdx = messages.length - 1;
  const totalUsage = { inputTokens: 0, outputTokens: 0 };
  let compactions = 0;

  let iterations = 0;

  while (iterations < maxIterations) {
    iterations++;

    // Check abort signal between iterations
    if (abortSignal?.aborted) {
      const lastAssistant = messages.filter((m) => m.role === 'assistant').pop();
      const fallbackText = extractText(lastAssistant);
      emit(onEvent, { type: 'done', text: fallbackText, iterations });
      return { text: fallbackText, messages, iterations, usage: totalUsage, compactions };
    }

    // ── Memory: check if compaction is needed ───────────────────────
    if (budget.shouldCompact(messages, systemPrompt)) {
      const result = await compactMessages(messages, provider, model, budget, {
        preserveRecentTurns: memory?.preserveRecentTurns,
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

    // ── Thought: ask the LLM (streaming when available) ───────────────
    const response = provider.streamWithTools
      ? await provider.streamWithTools({
          model,
          system: systemPrompt,
          messages,
          tools: toolSchemas.length > 0 ? toolSchemas : undefined,
          onTextDelta: (text) => emit(onEvent, { type: 'text_delta', text }),
        })
      : await provider.completeWithTools({
          model,
          system: systemPrompt,
          messages,
          tools: toolSchemas.length > 0 ? toolSchemas : undefined,
        });

    if (response.usage) {
      totalUsage.inputTokens += response.usage.inputTokens;
      totalUsage.outputTokens += response.usage.outputTokens;
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
      // Rehydrate PII tags in the final response so the user sees original values
      const finalText = piiScanner && piiMap ? await piiScanner.restore(thoughtText, piiMap) : thoughtText;
      emit(onEvent, { type: 'done', text: finalText, iterations });
      messages.push({ role: 'assistant', content: response.content });
      // Restore original user message in history so future turns don't see stale PII tags
      if (piiMap) {
        messages[originalUserIdx] = { role: 'user', content: userMessage };
      }
      return { text: finalText, messages, iterations, usage: totalUsage, compactions };
    }

    // ── Action: execute tool calls ────────────────────────────────────
    const toolCalls: ToolCall[] = toolUseBlocks.map((b) => ({
      id: b.id,
      name: b.name,
      input: b.input,
    }));
    emit(onEvent, { type: 'action', toolCalls });

    // Append assistant message with tool_use blocks
    messages.push({ role: 'assistant', content: response.content });

    // Execute all tool calls (parallel, individually guarded)
    const results: ToolCallResult[] = await Promise.all(
      toolCalls.map(async (call) => {
        try {
          const result = await executor.execute(call.name, call.input, { agentId });
          return { toolCallId: call.id, name: call.name, result };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            toolCallId: call.id,
            name: call.name,
            result: { content: `Unexpected error in ${call.name}: ${msg}`, isError: true },
          };
        }
      }),
    );

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
