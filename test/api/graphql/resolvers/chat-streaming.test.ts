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

  it('publishes every streamed delta across multiple tool iterations', async () => {
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

    const textDeltas = chatEvents.filter((event) => event.type === 'TEXT_DELTA').map((event) => event.delta);
    expect(textDeltas).toEqual(['first-pass thinking', 'second-pass planning', 'final streamed answer']);

    const toolUses = chatEvents.filter((event) => event.type === 'TOOL_USE').map((event) => event.toolName);
    expect(toolUses).toEqual(['lookup_price', 'lookup_news']);

    expect(chatEvents.at(-1)).toMatchObject({
      type: 'MESSAGE_COMPLETE',
      content: 'final streamed answer',
    });
  });
});
