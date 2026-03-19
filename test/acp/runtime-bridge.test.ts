import { describe, expect, it, vi } from 'vitest';

import type { AgentRuntimeLike } from '../../src/acp/runtime-bridge.js';
import { LocalRuntimeBridge, callbackToAsyncIterable } from '../../src/acp/runtime-bridge.js';
import type { AgentLoopEvent } from '../../src/core/types.js';

describe('callbackToAsyncIterable', () => {
  it('yields pushed items in order', async () => {
    const { push, done, iterable } = callbackToAsyncIterable<number>();
    push(1);
    push(2);
    push(3);
    done();

    const collected: number[] = [];
    for await (const item of iterable) {
      collected.push(item);
    }
    expect(collected).toEqual([1, 2, 3]);
  });

  it('waits for items when queue is empty', async () => {
    const { push, done, iterable } = callbackToAsyncIterable<string>();

    const collected: string[] = [];
    const consuming = (async () => {
      for await (const item of iterable) {
        collected.push(item);
      }
    })();

    await new Promise((r) => setTimeout(r, 10));
    push('a');
    await new Promise((r) => setTimeout(r, 10));
    push('b');
    done();

    await consuming;
    expect(collected).toEqual(['a', 'b']);
  });

  it('yields queued items before throwing on error', async () => {
    const { push, error, iterable } = callbackToAsyncIterable<string>();
    push('a');
    push('b');
    error(new Error('boom'));

    const collected: string[] = [];
    await expect(async () => {
      for await (const item of iterable) {
        collected.push(item);
      }
    }).rejects.toThrow('boom');
    expect(collected).toEqual(['a', 'b']);
  });

  it('terminates on error with empty queue', async () => {
    const { error, iterable } = callbackToAsyncIterable<string>();
    error(new Error('boom'));

    await expect(async () => {
      for await (const _item of iterable) {
        // consume
      }
    }).rejects.toThrow('boom');
  });
});

describe('LocalRuntimeBridge', () => {
  it('sendPrompt yields events from handleMessage onEvent callback', async () => {
    const mockRuntime: AgentRuntimeLike = {
      handleMessage: vi.fn(async (params) => {
        params.onEvent?.({ type: 'thought', text: 'thinking' });
        params.onEvent?.({ type: 'done', text: 'answer', iterations: 1 });
        return 'answer';
      }),
    };
    const bridge = new LocalRuntimeBridge(mockRuntime);

    const events: AgentLoopEvent[] = [];
    for await (const event of bridge.sendPrompt({
      message: 'hello',
      channelId: 'acp',
      userId: 'local',
      threadId: 'acp:123',
    })) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: 'thought', text: 'thinking' });
    expect(mockRuntime.handleMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'acp', threadId: 'acp:123' }),
    );
  });

  it('abort cancels in-flight prompt', async () => {
    let capturedSignal: AbortSignal | undefined;
    const mockRuntime: AgentRuntimeLike = {
      handleMessage: vi.fn(async (params) => {
        capturedSignal = params.abortSignal;
        // Wait until aborted — mirrors real agent loop behavior
        await new Promise<void>((resolve) => {
          if (params.abortSignal?.aborted) return resolve();
          params.abortSignal?.addEventListener('abort', () => resolve(), { once: true });
        });
        return 'answer';
      }),
    };
    const bridge = new LocalRuntimeBridge(mockRuntime);

    const consuming = (async () => {
      for await (const _event of bridge.sendPrompt({
        message: 'hello',
        channelId: 'acp',
        userId: 'local',
        threadId: 'acp:456',
      })) {
        // consume
      }
    })();

    await new Promise((r) => setTimeout(r, 10));
    await bridge.abort('acp:456');
    expect(capturedSignal?.aborted).toBe(true);
    await consuming;
  });
});
