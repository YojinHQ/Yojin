import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useMutation, useSubscription } from 'urql';

export interface ChatMessage {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  piiProtected?: boolean;
  piiTypes?: string[];
}

interface ChatEvent {
  type: 'THINKING' | 'TOOL_USE' | 'TEXT_DELTA' | 'MESSAGE_COMPLETE' | 'PII_REDACTED' | 'ERROR';
  threadId: string;
  delta?: string;
  messageId?: string;
  content?: string;
  error?: string;
  toolName?: string;
  piiTypesFound?: string[];
}

const SEND_MESSAGE_MUTATION = `
  mutation SendMessage($threadId: String!, $message: String!, $imageBase64: String, $imageMediaType: String) {
    sendMessage(threadId: $threadId, message: $message, imageBase64: $imageBase64, imageMediaType: $imageMediaType) {
      threadId
      messageId
    }
  }
`;

const CHAT_SUBSCRIPTION = `
  subscription OnChatMessage($threadId: String!) {
    onChatMessage(threadId: $threadId) {
      type
      threadId
      delta
      messageId
      content
      error
      toolName
      piiTypesFound
    }
  }
`;

export interface ChatImageData {
  base64: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
}

interface ChatContextValue {
  messages: ChatMessage[];
  streamingContent: string;
  isLoading: boolean;
  isThinking: boolean;
  activeTools: string[];
  sendMessage: (content: string, image?: ChatImageData) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useChatContext(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChatContext must be used within ChatProvider');
  return ctx;
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const [threadId] = useState(() => `web-${crypto.randomUUID()}`);
  const completedMessagesRef = useRef(new Set<string>());
  const queueRef = useRef<string[]>([]);
  const isProcessingRef = useRef(false);
  const piiDetectedRef = useRef(false);
  const piiTypesRef = useRef<string[]>([]);

  const [, sendMessageMutation] = useMutation(SEND_MESSAGE_MUTATION);
  const processQueueRef = useRef<() => void>(() => {});

  const resetStreamingState = useCallback(() => {
    setStreamingContent('');
    setIsThinking(false);
    setActiveTools([]);
    setIsLoading(false);
    isProcessingRef.current = false;
  }, []);

  const processMessage = useCallback(
    async (content: string, image?: ChatImageData) => {
      isProcessingRef.current = true;
      piiDetectedRef.current = false;
      piiTypesRef.current = [];
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
      } else if (event.type === 'TOOL_USE' && event.toolName) {
        setIsThinking(false);
        setActiveTools((prev) => [...prev, event.toolName ?? '']);
      } else if (event.type === 'TEXT_DELTA' && event.delta != null) {
        setIsThinking(false);
        setActiveTools([]);
        setStreamingContent((prev) => prev + event.delta);
      } else if (event.type === 'MESSAGE_COMPLETE') {
        const msgId = event.messageId ?? crypto.randomUUID();
        if (completedMessagesRef.current.has(msgId)) return data;
        completedMessagesRef.current.add(msgId);
        setMessages((prev) => [
          ...prev,
          {
            id: msgId,
            role: 'assistant',
            content: event.content ?? '',
            piiProtected: piiDetectedRef.current,
            piiTypes: piiTypesRef.current,
          },
        ]);
        resetStreamingState();
        setTimeout(() => processQueue(), 0);
      } else if (event.type === 'ERROR') {
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: 'assistant', content: `Sorry, something went wrong. ${event.error ?? ''}` },
        ]);
        resetStreamingState();
        setTimeout(() => processQueue(), 0);
      }

      return data;
    },
    [processQueue, resetStreamingState],
  );

  useSubscription({ query: CHAT_SUBSCRIPTION, variables: { threadId } }, handleSubscription);

  const sendMessage = useCallback(
    (content: string, image?: ChatImageData) => {
      if (isProcessingRef.current) {
        // Queue text-only — images are not queued to avoid holding large base64 strings in memory.
        // Warn the user that the image will not be sent.
        if (image) {
          alert(
            'A message is still being processed. Your image was not included — please re-attach it after the response completes.',
          );
        }
        // Don't append to messages here — processQueue does it when the message is actually sent.
        queueRef.current.push(content);
      } else {
        setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', content }]);
        processMessage(content, image);
      }
    },
    [processMessage],
  );

  const value: ChatContextValue = {
    messages,
    streamingContent,
    isLoading,
    isThinking,
    activeTools,
    sendMessage,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
