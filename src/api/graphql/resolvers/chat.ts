/**
 * Chat resolvers — sendMessage mutation + onChatMessage subscription + session queries.
 *
 * Streams agent responses via GraphQL subscriptions (SSE) using pubsub.
 * AgentRuntime is injected at startup via setChatAgentRuntime().
 * SessionStore is injected via setSessionStore().
 */

import { handleProviderCredentialError, isProviderCredentialError } from '../../../ai-providers/credential-error.js';
import { type AgentRuntime, DEFAULT_MODEL } from '../../../core/agent-runtime.js';
import type { AgentLoopEvent, AgentMessage, ContentBlock, ImageMediaType, ToolUseBlock } from '../../../core/types.js';
import type { SessionStore } from '../../../sessions/types.js';
import { pubsub } from '../pubsub.js';
import type { ChatEvent, ToolCardRef } from '../types.js';

/** Display tool prefix — tools named `display_*` trigger TOOL_CARD events. */
const DISPLAY_TOOL_PREFIX = 'display_';

/** Strategy Studio thread prefix — sessions starting with this are filtered from the sidebar. */
const STRATEGY_STUDIO_PREFIX = 'strategy-studio-';

/** Convert a display tool name to a frontend card name (snake_case → kebab-case, strip prefix). */
function toCardName(toolName: string): string {
  return toolName.slice(DISPLAY_TOOL_PREFIX.length).replace(/_/g, '-');
}

/** Extract tool card refs from ContentBlock[] for display_* tool calls. */
function extractToolCards(content: string | ContentBlock[]): ToolCardRef[] {
  if (typeof content === 'string') return [];
  return content
    .filter((b): b is ToolUseBlock => b.type === 'tool_use' && b.name.startsWith(DISPLAY_TOOL_PREFIX))
    .map((b) => ({
      tool: toCardName(b.name),
      params: JSON.stringify(b.input ?? {}),
    }));
}

let runtime: AgentRuntime | undefined;
let sessionStore: SessionStore | undefined;

/** Track the most recently active web session threadId. */
let activeThreadId: string | undefined;

/** Inject the AgentRuntime — called once from Gateway at startup. */
export function setChatAgentRuntime(agentRuntime: AgentRuntime): void {
  runtime = agentRuntime;
}

/** Inject the SessionStore — called once from Gateway at startup. */
export function setSessionStore(store: SessionStore): void {
  sessionStore = store;
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

  // Track the most recent web thread for activeSession query.
  if (!threadId.startsWith(STRATEGY_STUDIO_PREFIX)) {
    activeThreadId = threadId;
  }

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

      let streamAccumulatedText = '';

      // runtime is guaranteed non-null — checked above before the void IIFE
      await (runtime as AgentRuntime).handleMessage({
        message,
        channelId: 'web',
        userId: 'web-user',
        threadId,
        ...(imageBase64 && validatedImageType ? { imageBase64, imageMediaType: validatedImageType } : {}),
        onEvent: (event: AgentLoopEvent) => {
          if (event.type === 'text_delta') {
            streamAccumulatedText += event.text;
            pubsub.publish(`chat:${threadId}`, {
              type: 'TEXT_DELTA',
              threadId,
              delta: event.text,
              accumulatedText: streamAccumulatedText,
            } satisfies ChatEvent);
          } else if (event.type === 'action') {
            for (const call of event.toolCalls) {
              // Display tools emit a TOOL_CARD event for frontend rendering
              if (call.name.startsWith(DISPLAY_TOOL_PREFIX)) {
                pubsub.publish(`chat:${threadId}`, {
                  type: 'TOOL_CARD',
                  threadId,
                  toolCard: {
                    tool: toCardName(call.name),
                    params: JSON.stringify(call.input ?? {}),
                  },
                } satisfies ChatEvent);
              }
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
              messageId,
              error: 'Agent reached maximum iterations without completing.',
            } satisfies ChatEvent);
          }
        },
      });
    } catch (err) {
      let errorMessage: string;
      if (isProviderCredentialError(err)) {
        // The agent-loop already dispatches handleProviderCredentialError() when
        // it detects an auth error, but the chat path catches errors that may
        // bypass the loop (e.g. provider.initialize() failures). Call it here
        // too as a safety net — it is idempotent and mode-aware (skips the
        // wipe in OAuth mode where the vault is not the source of truth).
        void handleProviderCredentialError();
        // Mode-agnostic message: in api_key mode the vault entry was cleared,
        // in OAuth mode the keychain token is stale and the provider's
        // internal refresh already failed. Either way, the user resolves this
        // in Settings → Connections.
        errorMessage = 'Your Claude credential could not be validated. Open Settings → Connections to reconnect.';
      } else {
        errorMessage = err instanceof Error ? err.message : String(err);
      }

      pubsub.publish(`chat:${threadId}`, {
        type: 'ERROR',
        threadId,
        messageId,
        error: errorMessage,
      } satisfies ChatEvent);
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

// ---------------------------------------------------------------------------
// Session queries + mutations
// ---------------------------------------------------------------------------

/** Derive a session title from the first user message (truncated to ~50 chars). */
function deriveTitle(messages: AgentMessage[]): string {
  const firstUserMsg = messages.find((m) => m.role === 'user');
  if (!firstUserMsg) return 'New conversation';
  const text =
    typeof firstUserMsg.content === 'string'
      ? firstUserMsg.content
      : firstUserMsg.content
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map((b) => b.text)
          .join(' ');
  if (!text) return 'New conversation';
  return text.length > 50 ? text.slice(0, 47) + '…' : text;
}

interface SessionSummaryGql {
  id: string;
  threadId: string;
  title: string;
  createdAt: string;
  lastMessageAt: string | null;
  messageCount: number;
}

export async function sessionsQuery(): Promise<SessionSummaryGql[]> {
  if (!sessionStore) return [];

  const ids = await sessionStore.list();
  const summaries: SessionSummaryGql[] = [];

  for (const id of ids) {
    const [meta, history] = await Promise.all([sessionStore.get(id), sessionStore.getHistory(id)]);
    if (!meta) continue;
    // Only show web channel sessions in the sidebar
    if (meta.channelId !== 'web') continue;
    if ((meta.threadId ?? '').startsWith(STRATEGY_STUDIO_PREFIX)) continue;

    const messages = history.map((e) => e.message);
    const lastEntry = history[history.length - 1];

    summaries.push({
      id: meta.id,
      threadId: meta.threadId ?? meta.id,
      title: deriveTitle(messages),
      createdAt: new Date(meta.createdAt).toISOString(),
      lastMessageAt: lastEntry?.timestamp ?? null,
      messageCount: history.length,
    });
  }

  // Sort by most recent first
  summaries.sort((a, b) => {
    const aTime = a.lastMessageAt ?? a.createdAt;
    const bTime = b.lastMessageAt ?? b.createdAt;
    return bTime.localeCompare(aTime);
  });

  return summaries;
}

export async function sessionQuery(
  _parent: unknown,
  args: { id: string },
): Promise<{
  id: string;
  threadId: string;
  title: string;
  createdAt: string;
  lastMessageAt: string | null;
  messages: {
    id: string;
    threadId: string;
    role: string;
    content: string;
    timestamp: string;
    toolCards: ToolCardRef[];
  }[];
} | null> {
  if (!sessionStore) return null;

  const meta = await sessionStore.get(args.id);
  if (!meta) return null;

  const history = await sessionStore.getHistory(args.id);
  const agentMessages = history.map((e) => e.message);
  const lastEntry = history[history.length - 1];

  const gqlMessages = history.map((entry) => ({
    id: `${entry.sessionId}-${entry.sequence}`,
    threadId: meta.threadId ?? meta.id,
    role: entry.message.role === 'user' ? 'USER' : 'ASSISTANT',
    content:
      typeof entry.message.content === 'string'
        ? entry.message.content
        : entry.message.content
            .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
            .map((b) => b.text)
            .join('\n'),
    timestamp: entry.timestamp,
    // Reconstruct tool card refs from persisted ToolUseBlock entries
    toolCards: extractToolCards(entry.message.content),
  }));

  return {
    id: meta.id,
    threadId: meta.threadId ?? meta.id,
    title: deriveTitle(agentMessages),
    createdAt: new Date(meta.createdAt).toISOString(),
    lastMessageAt: lastEntry?.timestamp ?? null,
    messages: gqlMessages,
  };
}

export async function activeSessionQuery(): Promise<SessionSummaryGql | null> {
  if (!sessionStore || !activeThreadId) return null;

  const meta = await sessionStore.getByThread('web', activeThreadId);
  if (!meta) return null;

  const history = await sessionStore.getHistory(meta.id);
  const messages = history.map((e) => e.message);
  const lastEntry = history[history.length - 1];

  return {
    id: meta.id,
    threadId: meta.threadId ?? meta.id,
    title: deriveTitle(messages),
    createdAt: new Date(meta.createdAt).toISOString(),
    lastMessageAt: lastEntry?.timestamp ?? null,
    messageCount: history.length,
  };
}

export async function createSessionMutation(): Promise<SessionSummaryGql> {
  if (!sessionStore) throw new Error('Session store not initialized');

  const threadId = `web-${crypto.randomUUID()}`;
  const meta = await sessionStore.create({
    channelId: 'web',
    threadId,
    userId: 'web-user',
    providerId: 'agent-runtime',
    model: DEFAULT_MODEL,
  });

  activeThreadId = threadId;

  return {
    id: meta.id,
    threadId,
    title: 'New conversation',
    createdAt: new Date(meta.createdAt).toISOString(),
    lastMessageAt: null,
    messageCount: 0,
  };
}

export async function deleteSessionMutation(_parent: unknown, args: { id: string }): Promise<boolean> {
  if (!sessionStore) throw new Error('Session store not initialized');
  await sessionStore.delete(args.id);
  return true;
}
