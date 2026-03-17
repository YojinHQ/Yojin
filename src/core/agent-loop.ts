/**
 * AgentLoop — the core Thought → Action → Observation cycle.
 *
 * 1. Send conversation + tool schemas to the LLM
 * 2. If the LLM returns tool_use blocks → execute via ToolRegistry → append results → loop
 * 3. If the LLM returns end_turn (text only, no tool calls) → return final response
 */

import { ToolRegistry } from './tool-registry.js';
import type {
  AgentLoopOptions,
  AgentLoopEvent,
  AgentMessage,
  ToolCall,
  ToolCallResult,
  ToolUseBlock,
  ToolResultBlock,
  TextBlock,
} from './types.js';

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
    onEvent,
  } = options;

  const registry = new ToolRegistry();
  for (const tool of tools) {
    registry.register(tool);
  }

  const toolSchemas = registry.toSchemas();
  const messages: AgentMessage[] = [...history, { role: 'user', content: userMessage }];
  const totalUsage = { inputTokens: 0, outputTokens: 0 };

  let iterations = 0;

  while (iterations < maxIterations) {
    iterations++;

    // ── Thought: ask the LLM ──────────────────────────────────────────
    const response = await provider.completeWithTools({
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
      emit(onEvent, { type: 'done', text: thoughtText, iterations });
      messages.push({ role: 'assistant', content: response.content });
      return { text: thoughtText, messages, iterations, usage: totalUsage };
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
          const result = await registry.execute(call.name, call.input);
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
  const lastAssistant = messages.filter((m) => m.role === 'assistant').pop();
  const fallbackText = extractText(lastAssistant);
  return {
    text:
      fallbackText ||
      'I reached the maximum number of steps. Please try again with a simpler request.',
    messages,
    iterations,
    usage: totalUsage,
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
