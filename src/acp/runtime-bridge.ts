import type { AgentLoopEvent, AgentLoopEventHandler } from '../core/types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('runtime-bridge');

export interface RuntimeBridge {
  sendPrompt(params: {
    message: string;
    channelId: string;
    userId: string;
    threadId?: string;
    abortSignal?: AbortSignal;
  }): AsyncIterable<AgentLoopEvent>;

  /** Abort an in-flight prompt. Key is the threadId used in sendPrompt. */
  abort(threadId: string): Promise<void>;
}

export interface AgentRuntimeLike {
  handleMessage(params: {
    message: string;
    channelId: string;
    userId: string;
    threadId?: string;
    onEvent?: AgentLoopEventHandler;
    abortSignal?: AbortSignal;
  }): Promise<string>;
}

export class LocalRuntimeBridge implements RuntimeBridge {
  private abortControllers = new Map<string, AbortController>();

  constructor(private readonly runtime: AgentRuntimeLike) {}

  sendPrompt(params: {
    message: string;
    channelId: string;
    userId: string;
    threadId?: string;
    abortSignal?: AbortSignal;
  }): AsyncIterable<AgentLoopEvent> {
    const { push, done, error, iterable } = callbackToAsyncIterable<AgentLoopEvent>();

    if (params.threadId) {
      const controller = new AbortController();
      this.abortControllers.set(params.threadId, controller);
      params.abortSignal?.addEventListener('abort', () => controller.abort(), { once: true });

      this.runtime
        .handleMessage({
          message: params.message,
          channelId: params.channelId,
          userId: params.userId,
          threadId: params.threadId,
          onEvent: push,
          abortSignal: controller.signal,
        })
        .then(() => done())
        .catch((err) => error(err instanceof Error ? err : new Error(String(err))))
        .finally(() => {
          if (params.threadId) this.abortControllers.delete(params.threadId);
        });
    } else {
      logger.warn('sendPrompt called without threadId — abort() will not work for this prompt');
      this.runtime
        .handleMessage({
          message: params.message,
          channelId: params.channelId,
          userId: params.userId,
          onEvent: push,
          abortSignal: params.abortSignal,
        })
        .then(() => done())
        .catch((err) => error(err instanceof Error ? err : new Error(String(err))));
    }

    return iterable;
  }

  async abort(threadId: string): Promise<void> {
    const controller = this.abortControllers.get(threadId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(threadId);
    }
  }
}

export function callbackToAsyncIterable<T>(): {
  push: (item: T) => void;
  done: () => void;
  error: (err: Error) => void;
  iterable: AsyncIterable<T>;
} {
  const queue: T[] = [];
  let resolve: (() => void) | null = null;
  let finished = false;
  let rejected: Error | null = null;

  return {
    push(item: T) {
      queue.push(item);
      resolve?.();
    },
    done() {
      finished = true;
      resolve?.();
    },
    error(err: Error) {
      rejected = err;
      resolve?.();
    },
    iterable: {
      async *[Symbol.asyncIterator]() {
        while (true) {
          if (queue.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- length > 0 guarantees element exists
            yield queue.shift()!;
            continue;
          }
          if (rejected) throw rejected;
          if (finished) return;
          await new Promise<void>((r) => {
            resolve = r;
          });
          resolve = null;
        }
      },
    },
  };
}
