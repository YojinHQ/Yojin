/**
 * Chat resolvers — sendMessage mutation + onChatMessage subscription.
 *
 * Streams agent responses via GraphQL subscriptions (SSE) using pubsub.
 * AgentRuntime is injected at startup via setChatAgentRuntime().
 */

import type { AgentRuntime } from '../../../core/agent-runtime.js';
import type { AgentLoopEvent, ImageMediaType } from '../../../core/types.js';
import { pubsub } from '../pubsub.js';
import type { ChatEvent } from '../types.js';

let runtime: AgentRuntime | undefined;

/** Inject the AgentRuntime — called once from Gateway at startup. */
export function setChatAgentRuntime(agentRuntime: AgentRuntime): void {
  runtime = agentRuntime;
}

// ---------------------------------------------------------------------------
// Mutation: sendMessage
// ---------------------------------------------------------------------------

const VALID_IMAGE_TYPES: ReadonlySet<string> = new Set<ImageMediaType>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

export function sendMessageMutation(
  _parent: unknown,
  args: { threadId: string; message: string; imageBase64?: string; imageMediaType?: string },
): { threadId: string; messageId: string } {
  if (!runtime) {
    throw new Error('Chat runtime not initialized');
  }

  const { threadId, message, imageBase64, imageMediaType } = args;
  const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Server-side size guard: reject base64 payloads over ~10 MB decoded
  // (base64 is ~4/3 of original size, so 14 MB base64 ≈ 10.5 MB decoded)
  const MAX_IMAGE_BASE64_LENGTH = 14 * 1024 * 1024;
  if (imageBase64 && imageBase64.length > MAX_IMAGE_BASE64_LENGTH) {
    throw new Error('Image too large — maximum size is 10 MB.');
  }

  // Fire-and-forget: run agent in background, stream events via pubsub
  void (async () => {
    try {
      // Emit thinking state immediately
      pubsub.publish(`chat:${threadId}`, { type: 'THINKING', threadId } satisfies ChatEvent);

      // Validate image type — reject early if base64 is provided with bad/missing type
      if (imageBase64 && (!imageMediaType || !VALID_IMAGE_TYPES.has(imageMediaType))) {
        throw new Error(
          `Unsupported image type: ${imageMediaType ?? 'none'}. Accepted: image/jpeg, image/png, image/gif, image/webp`,
        );
      }
      const validatedImageType = imageBase64 ? (imageMediaType as ImageMediaType) : undefined;

      // runtime is guaranteed non-null — checked above before the void IIFE
      await (runtime as AgentRuntime).handleMessage({
        message,
        channelId: 'web',
        userId: 'web-user',
        threadId,
        ...(imageBase64 && validatedImageType ? { imageBase64, imageMediaType: validatedImageType } : {}),
        onEvent: (event: AgentLoopEvent) => {
          if (event.type === 'text_delta') {
            pubsub.publish(`chat:${threadId}`, {
              type: 'TEXT_DELTA',
              threadId,
              delta: event.text,
            } satisfies ChatEvent);
          } else if (event.type === 'action') {
            for (const call of event.toolCalls) {
              pubsub.publish(`chat:${threadId}`, {
                type: 'TOOL_USE',
                threadId,
                toolName: call.name,
              } satisfies ChatEvent);
            }
          } else if (event.type === 'pii_redacted') {
            pubsub.publish(`chat:${threadId}`, {
              type: 'PII_REDACTED',
              threadId,
              piiTypesFound: event.typesFound,
            } satisfies ChatEvent);
          } else if (event.type === 'done') {
            pubsub.publish(`chat:${threadId}`, {
              type: 'MESSAGE_COMPLETE',
              threadId,
              messageId,
              content: event.text,
            } satisfies ChatEvent);
          } else if (event.type === 'max_iterations') {
            pubsub.publish(`chat:${threadId}`, {
              type: 'ERROR',
              threadId,
              error: 'Agent reached maximum iterations without completing.',
            } satisfies ChatEvent);
          }
        },
      });
    } catch (err) {
      const chatEvent: ChatEvent = {
        type: 'ERROR',
        threadId,
        error: err instanceof Error ? err.message : String(err),
      };
      pubsub.publish(`chat:${threadId}`, chatEvent);
    }
  })();

  return { threadId, messageId };
}

// ---------------------------------------------------------------------------
// Subscription: onChatMessage
// ---------------------------------------------------------------------------

export const onChatMessageSubscription = {
  subscribe: (_parent: unknown, args: { threadId: string }) => {
    return pubsub.subscribe(`chat:${args.threadId}`);
  },
  resolve: (payload: ChatEvent) => payload,
};
