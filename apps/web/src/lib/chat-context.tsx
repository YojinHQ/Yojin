import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useClient, useMutation, useSubscription } from 'urql';
import { ACTIVE_SESSION_QUERY, SESSION_DETAIL_QUERY } from './session-queries';
import { SEND_MESSAGE_MUTATION, CHAT_SUBSCRIPTION } from './chat-documents.js';

export interface ToolCardRef {
  tool: string;
  params: string; // JSON-encoded
}

export interface ChatMessage {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  piiProtected?: boolean;
  piiTypes?: string[];
  toolCards?: ToolCardRef[];
}

export interface ChatEvent {
  type:
    | 'THINKING'
    | 'TOOL_USE'
    | 'TEXT_DELTA'
    | 'TEXT_RESET'
    | 'MESSAGE_COMPLETE'
    | 'PII_REDACTED'
    | 'ERROR'
    | 'TOOL_CARD';
  threadId: string;
  delta?: string;
  accumulatedText?: string;
  messageId?: string;
  content?: string;
  error?: string;
  toolName?: string;
  piiTypesFound?: string[];
  toolCard?: ToolCardRef;
}

export interface ChatImageData {
  base64: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
}

/** Session info exposed to consumers. */
export interface ActiveSessionInfo {
  sessionId: string | null;
  threadId: string;
}

interface ChatContextValue {
  messages: ChatMessage[];
  pendingMessages: ChatMessage[];
  streamingContent: string;
  isLoading: boolean;
  isThinking: boolean;
  activeTools: string[];
  /** Tool cards detected during current agent turn (drives skeleton loading). */
  pendingToolCards: ToolCardRef[];
  sendMessage: (content: string, image?: ChatImageData) => void;
  /** Current session info. */
  activeSession: ActiveSessionInfo;
  /** Switch to an existing session or start a new one (pass null). */
  switchSession: (sessionId: string | null, threadId?: string) => void;
  /** Increments when session list may have changed (message sent, session created, etc.). */
  sessionVersion: number;
}

const STORAGE_KEY = 'yojin-active-thread';
const SESSION_STORAGE_KEY = 'yojin-active-session';

const ChatContext = createContext<ChatContextValue | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useChatContext(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChatContext must be used within ChatProvider');
  return ctx;
}

/**
 * Collapse raw session history into the user-facing message list.
 *
 * The session store keeps every API-level message (intermediate tool-call assistant
 * messages, tool-result user messages, and the final text assistant message). This
 * merges tool cards from intermediate assistant messages into the final assistant
 * response and drops empty tool-result messages so the chat renders cleanly.
 */
function collapseSessionMessages(
  raw: { id: string; role: string; content: string; toolCards?: ToolCardRef[] }[],
): ChatMessage[] {
  const result: ChatMessage[] = [];
  let pendingToolCards: ToolCardRef[] = [];

  for (const m of raw) {
    const role = m.role === 'USER' ? ('user' as const) : ('assistant' as const);

    if (role === 'assistant') {
      // Accumulate tool cards from intermediate assistant messages (tool-call turns)
      if (m.toolCards?.length) {
        pendingToolCards.push(...m.toolCards);
      }
      // If this assistant message has no tool cards, it's the final text response —
      // attach any accumulated tool cards and emit.
      if (!m.toolCards?.length && m.content) {
        result.push({
          id: m.id,
          role,
          content: m.content,
          toolCards: pendingToolCards.length > 0 ? [...pendingToolCards] : undefined,
        });
        pendingToolCards = [];
      }
      // Skip assistant messages that only have tool cards (merged into next) or are empty
    } else {
      // Keep real user messages (with content); drop empty tool-result messages
      if (m.content) {
        result.push({ id: m.id, role, content: m.content });
      }
    }
  }

  // If there are leftover tool cards with no final text, emit them standalone
  if (pendingToolCards.length > 0) {
    result.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      toolCards: pendingToolCards,
    });
  }

  return result;
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const client = useClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingMessages, setPendingMessages] = useState<ChatMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [activeTools, setActiveTools] = useState<string[]>([]);
  // Reactive mirror of toolCardsRef — drives skeleton rendering in the UI
  const [pendingToolCards, setPendingToolCards] = useState<ToolCardRef[]>([]);

  // Session state — restored from localStorage or new
  const [threadId, setThreadId] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored || `web-${crypto.randomUUID()}`;
  });
  const [sessionId, setSessionId] = useState<string | null>(() => localStorage.getItem(SESSION_STORAGE_KEY));

  // Version counter — bumped whenever the backend session list may have changed
  const [sessionVersion, setSessionVersion] = useState(0);
  // Guard against stale async results in switchSession
  const switchVersionRef = useRef(0);

  const completedMessagesRef = useRef(new Set<string>());
  const queueRef = useRef<string[]>([]);
  const isProcessingRef = useRef(false);
  const piiDetectedRef = useRef(false);
  const piiTypesRef = useRef<string[]>([]);
  // Accumulate tool cards during streaming — attached to the message on MESSAGE_COMPLETE
  const toolCardsRef = useRef<ToolCardRef[]>([]);
  // Mirror sessionId as a ref so the subscription handler can read it without re-creating
  const sessionIdRef = useRef(sessionId);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const [, sendMessageMutation] = useMutation(SEND_MESSAGE_MUTATION);
  const processQueueRef = useRef<() => void>(() => {});

  // Persist active threadId and sessionId to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, threadId);
  }, [threadId]);
  useEffect(() => {
    if (sessionId) {
      localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }, [sessionId]);

  // Restore session messages on mount if we have a persisted sessionId
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    void (async () => {
      const result = await client
        .query(SESSION_DETAIL_QUERY, { id: sessionId }, { requestPolicy: 'network-only' })
        .toPromise();
      if (cancelled) return;
      if (result.data?.session) {
        const session = result.data.session as {
          threadId: string;
          messages: { id: string; role: string; content: string; toolCards?: ToolCardRef[] }[];
        };
        setThreadId(session.threadId);
        setMessages(collapseSessionMessages(session.messages));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetStreamingState = useCallback(() => {
    setStreamingContent('');
    setIsThinking(false);
    setActiveTools([]);
    setIsLoading(false);
    isProcessingRef.current = false;
    toolCardsRef.current = [];
    setPendingToolCards([]);
  }, []);

  const processMessage = useCallback(
    async (content: string, image?: ChatImageData) => {
      isProcessingRef.current = true;
      piiDetectedRef.current = false;
      piiTypesRef.current = [];
      toolCardsRef.current = [];
      setIsLoading(true);
      setStreamingContent('');
      setIsThinking(false);
      setActiveTools([]);

      const variables: Record<string, string> = { threadId, message: content };
      if (image) {
        variables.imageBase64 = image.base64;
        variables.imageMediaType = image.mediaType;
      }

      const result = await sendMessageMutation(variables);
      if (result.error) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `Sorry, I couldn't process that request. ${result.error?.message ?? ''}`,
          },
        ]);
        resetStreamingState();
        processQueueRef.current();
      }
    },
    [threadId, sendMessageMutation, resetStreamingState],
  );

  const processQueue = useCallback(() => {
    if (queueRef.current.length > 0 && !isProcessingRef.current) {
      const next = queueRef.current.shift();
      if (!next) return;
      // Move the first pending message into the main messages list.
      setPendingMessages((prev) => prev.slice(1));
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', content: next }]);
      processMessage(next);
    }
  }, [processMessage]);

  useEffect(() => {
    processQueueRef.current = processQueue;
  }, [processQueue]);

  const handleSubscription = useCallback(
    (_prev: unknown, data: { onChatMessage: ChatEvent }) => {
      const event = data.onChatMessage;

      if (event.type === 'THINKING') {
        setIsThinking(true);
        setActiveTools([]);
      } else if (event.type === 'PII_REDACTED') {
        piiDetectedRef.current = true;
        piiTypesRef.current = event.piiTypesFound ?? [];
      } else if (event.type === 'TOOL_CARD' && event.toolCard) {
        // Accumulate tool cards — deduplicate by tool+params so repeated calls
        // across agent loop iterations don't produce duplicate cards.
        const card = event.toolCard;
        const isDuplicate = toolCardsRef.current.some((c) => c.tool === card.tool && c.params === card.params);
        if (!isDuplicate) {
          toolCardsRef.current.push(card);
          // Update reactive state so the UI can show card skeletons immediately
          setPendingToolCards((prev) => [...prev, card]);
        }
      } else if (event.type === 'TOOL_USE' && event.toolName) {
        setIsThinking(false);
        setActiveTools((prev) => [...prev, event.toolName ?? '']);
      } else if (event.type === 'TEXT_DELTA' && event.delta != null) {
        setIsThinking(false);
        setActiveTools([]);
        // Use accumulatedText (idempotent set) to avoid doubling when StrictMode
        // creates two concurrent subscriptions that both process the same delta.
        if (event.accumulatedText != null) {
          setStreamingContent(event.accumulatedText);
        } else {
          setStreamingContent((prev) => prev + event.delta);
        }
      } else if (event.type === 'TEXT_RESET') {
        // Intermediate narration — the model is about to call a tool. Clear
        // the partial stream so the user only sees the final response.
        setStreamingContent('');
        setIsThinking(true);
      } else if (event.type === 'MESSAGE_COMPLETE') {
        const msgId = event.messageId ?? crypto.randomUUID();
        if (completedMessagesRef.current.has(msgId)) return data;
        completedMessagesRef.current.add(msgId);
        // Capture ref values BEFORE scheduling state update — resetStreamingState()
        // clears the refs synchronously, but setMessages updater runs deferred during render.
        const piiProtected = piiDetectedRef.current;
        const piiTypes = [...piiTypesRef.current];
        const toolCards = toolCardsRef.current.length > 0 ? [...toolCardsRef.current] : undefined;
        setMessages((prev) => [
          ...prev,
          {
            id: msgId,
            role: 'assistant',
            content: event.content ?? '',
            piiProtected,
            piiTypes,
            toolCards,
          },
        ]);
        // Notify sidebar that the session list may have changed (new session created, message count updated)
        setSessionVersion((v) => v + 1);
        // Resolve sessionId if this is the first message (backend creates session async)
        if (!sessionIdRef.current) {
          void client
            .query(ACTIVE_SESSION_QUERY, {}, { requestPolicy: 'network-only' })
            .toPromise()
            .then((r) => {
              const active = r.data?.activeSession as { id: string } | null;
              if (active?.id) setSessionId(active.id);
            });
        }
        resetStreamingState();
        setTimeout(() => processQueue(), 0);
      } else if (event.type === 'ERROR') {
        if (event.messageId) {
          if (completedMessagesRef.current.has(event.messageId)) return data;
          completedMessagesRef.current.add(event.messageId);
        }
        const isAuthError = event.error?.startsWith('[AUTH_EXPIRED]');
        const errorContent = isAuthError ? '[AUTH_EXPIRED]' : `Sorry, something went wrong. ${event.error ?? ''}`;
        setMessages((prev) => [
          ...prev,
          { id: event.messageId ?? crypto.randomUUID(), role: 'assistant', content: errorContent },
        ]);
        resetStreamingState();
        setTimeout(() => processQueue(), 0);
      }

      return data;
    },
    [client, processQueue, resetStreamingState],
  );

  // Always subscribe to the active thread
  useSubscription({ query: CHAT_SUBSCRIPTION, variables: { threadId } }, handleSubscription);

  const sendMessage = useCallback(
    (content: string, image?: ChatImageData) => {
      if (isProcessingRef.current) {
        queueRef.current.push(content);
        // Show queued message separately so it renders after the current streaming response.
        setPendingMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', content }]);
      } else {
        setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', content }]);
        processMessage(content, image);
      }
    },
    [processMessage],
  );

  /** Switch to a session. Pass null to start a new session. */
  const switchSession = useCallback(
    (newSessionId: string | null, newThreadId?: string) => {
      // Reset streaming state
      resetStreamingState();
      completedMessagesRef.current.clear();
      queueRef.current = [];
      setPendingMessages([]);

      // Increment switch version — any in-flight fetch from a previous switch will be discarded
      const version = ++switchVersionRef.current;

      if (newSessionId === null) {
        // New session — use provided threadId if available (e.g. from createSession mutation)
        const fresh = newThreadId ?? `web-${crypto.randomUUID()}`;
        setThreadId(fresh);
        setSessionId(null);
        setMessages([]);
        return;
      }

      // Load existing session — set threadId synchronously so the UI resets immediately
      setSessionId(newSessionId);
      setMessages([]);
      if (newThreadId) setThreadId(newThreadId);

      // Fetch session messages (network-only to avoid stale cached data)
      void (async () => {
        const result = await client
          .query(SESSION_DETAIL_QUERY, { id: newSessionId }, { requestPolicy: 'network-only' })
          .toPromise();

        // Stale guard: if another switch happened since we started, discard this result
        if (switchVersionRef.current !== version) return;

        if (result.data?.session) {
          const session = result.data.session as {
            threadId: string;
            messages: { id: string; role: string; content: string; toolCards?: ToolCardRef[] }[];
          };
          setThreadId(newThreadId ?? session.threadId);
          setMessages(collapseSessionMessages(session.messages));
        }
      })();
    },
    [client, resetStreamingState],
  );

  const activeSessionInfo: ActiveSessionInfo = {
    sessionId,
    threadId,
  };

  const value: ChatContextValue = {
    messages,
    pendingMessages,
    streamingContent,
    isLoading,
    isThinking,
    activeTools,
    pendingToolCards,
    sendMessage,
    activeSession: activeSessionInfo,
    switchSession,
    sessionVersion,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
