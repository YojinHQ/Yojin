import { afterEach, describe, expect, it, vi } from 'vitest';

import { pubsub } from '../../../../src/api/graphql/pubsub.js';
import { sendMessageMutation, setChatAgentRuntime } from '../../../../src/api/graphql/resolvers/chat.js';
import type { AgentLoopEventHandler, ToolCall } from '../../../../src/core/types.js';

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('chat streaming resolver', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('streams every delta but clears intermediate narration before each tool call', async () => {
    const publishSpy = vi.spyOn(pubsub, 'publish');
    const toolCall = (id: string, name: string): ToolCall => ({ id, name, input: {} });

    setChatAgentRuntime({
      handleMessage: async ({ onEvent }: { onEvent?: AgentLoopEventHandler }) => {
        onEvent?.({ type: 'text_delta', text: 'first-pass thinking' });
        onEvent?.({ type: 'action', toolCalls: [toolCall('tool-1', 'lookup_price')] });
        onEvent?.({ type: 'text_delta', text: 'second-pass planning' });
        onEvent?.({ type: 'action', toolCalls: [toolCall('tool-2', 'lookup_news')] });
        onEvent?.({ type: 'text_delta', text: 'final streamed answer' });
        onEvent?.({ type: 'done', text: 'final streamed answer', iterations: 3 });
        return 'final streamed answer';
      },
    } as never);

    sendMessageMutation(null, { threadId: 'thread-1', message: 'hi' });
    await flushAsyncWork();

    const chatEvents = publishSpy.mock.calls
      .filter(([channel]) => channel === 'chat:thread-1')
      .map(([, event]) => event);

    // All deltas are still emitted — the reset is the UX mechanism for hiding
    // intermediate narration, not a server-side filter.
    const textDeltas = chatEvents.filter((event) => event.type === 'TEXT_DELTA').map((event) => event.delta);
    expect(textDeltas).toEqual(['first-pass thinking', 'second-pass planning', 'final streamed answer']);

    // A TEXT_RESET fires on every `action` that follows streamed text, so the
    // frontend clears the partial narration before showing the tool card.
    const resetCount = chatEvents.filter((event) => event.type === 'TEXT_RESET').length;
    expect(resetCount).toBe(2);

    const toolUses = chatEvents.filter((event) => event.type === 'TOOL_USE').map((event) => event.toolName);
    expect(toolUses).toEqual(['lookup_price', 'lookup_news']);

    // Ordering: each TEXT_RESET comes between the narration delta and the
    // matching TOOL_USE for that iteration.
    const sequence = chatEvents.map((event) => event.type);
    expect(sequence).toEqual([
      'THINKING',
      'TEXT_DELTA',
      'TEXT_RESET',
      'TOOL_USE',
      'TEXT_DELTA',
      'TEXT_RESET',
      'TOOL_USE',
      'TEXT_DELTA',
      'MESSAGE_COMPLETE',
    ]);

    expect(chatEvents.at(-1)).toMatchObject({
      type: 'MESSAGE_COMPLETE',
      content: 'final streamed answer',
    });
  });
});
