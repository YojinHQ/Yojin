/**
 * StreamingToolExecutor — executes tool calls as they arrive during LLM streaming,
 * rather than waiting for the full response to complete.
 *
 * Inspired by Claude Code's StreamingToolExecutor pattern: tools start executing
 * as soon as each tool_use block is emitted by the LLM, overlapping tool execution
 * with the remainder of the LLM stream. This shaves seconds off multi-tool turns.
 */

import type { ToolCall, ToolCallResult, ToolExecutor } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('streaming-tool-executor');

export class StreamingToolExecutor {
  private readonly executor: ToolExecutor;
  private readonly agentId?: string;
  private readonly pending = new Map<string, Promise<ToolCallResult>>();
  private readonly completed: ToolCallResult[] = [];
  private readonly submissionOrder: string[] = [];

  constructor(executor: ToolExecutor, agentId?: string) {
    this.executor = executor;
    this.agentId = agentId;
  }

  /**
   * Submit a tool call for immediate execution. Returns immediately —
   * the tool runs in the background while the LLM stream continues.
   */
  addToolCall(call: ToolCall): void {
    // Guard against duplicate submissions (e.g. tool started during stream then re-submitted after)
    if (this.pending.has(call.id) || this.completed.some((r) => r.toolCallId === call.id)) {
      logger.debug('Tool call already submitted, skipping duplicate', { tool: call.name, id: call.id });
      return;
    }

    logger.debug('Streaming tool submitted', { tool: call.name, id: call.id });

    this.submissionOrder.push(call.id);
    const promise = this.executeTool(call);
    this.pending.set(call.id, promise);

    // Move to completed when done (fire-and-forget the bookkeeping)
    promise.then((result) => {
      this.pending.delete(call.id);
      this.completed.push(result);
    });
  }

  /**
   * Wait for all pending tool calls to complete and return all results
   * (both already-completed and still-pending) in submission order.
   */
  async awaitAll(): Promise<ToolCallResult[]> {
    if (this.pending.size > 0) {
      const remaining = Array.from(this.pending.values());
      logger.debug('Awaiting remaining tools', { count: remaining.length });
      await Promise.all(remaining);
    }
    // Return in submission order — completed array is in completion order (fastest first)
    return [...this.completed].sort(
      (a, b) => this.submissionOrder.indexOf(a.toolCallId) - this.submissionOrder.indexOf(b.toolCallId),
    );
  }

  /**
   * Get results that have already completed (non-blocking).
   */
  getCompletedResults(): ToolCallResult[] {
    return [...this.completed];
  }

  /** Number of tools still executing. */
  get pendingCount(): number {
    return this.pending.size;
  }

  private async executeTool(call: ToolCall): Promise<ToolCallResult> {
    try {
      const result = await this.executor.execute(call.name, call.input, { agentId: this.agentId });
      return { toolCallId: call.id, name: call.name, result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Streaming tool execution failed', { tool: call.name, error: msg });
      return {
        toolCallId: call.id,
        name: call.name,
        result: { content: `Unexpected error in ${call.name}: ${msg}`, isError: true },
      };
    }
  }
}
