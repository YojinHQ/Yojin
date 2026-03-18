import { useCallback, useRef, useState, useEffect } from 'react';
import MorningBriefing from '../components/chat/morning-briefing';
import QueryBuilder from '../components/chat/query-builder';
import ChatInput from '../components/chat/chat-input';
import ChatMessage from '../components/chat/chat-message';

interface Message {
  id: string;
  role: 'assistant' | 'user';
  content: string;
}

async function sendChatMessage(message: string, threadId: string): Promise<{ threadId: string; response: string }> {
  let res: Response;
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, threadId }),
    });
  } catch {
    throw new Error('Cannot reach the backend. Is the server running? (pnpm dev)');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  }

  const data = (await res.json()) as { threadId: string; response: string };
  if (typeof data.response !== 'string') {
    throw new Error('Unexpected response format from server');
  }
  return data;
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [threadId] = useState(() => `web-${crypto.randomUUID()}`);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleSend = useCallback(
    async (content: string) => {
      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
      };
      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);

      try {
        const { response } = await sendChatMessage(content, threadId);
        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: response,
        };
        setMessages((prev) => [...prev, assistantMessage]);
      } catch (err) {
        const errorText = err instanceof Error ? err.message : 'Something went wrong';
        const errorMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `Sorry, I couldn't process that request. ${errorText}`,
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsLoading(false);
      }
    },
    [threadId],
  );

  const handleQuerySelect = useCallback(
    (query: string) => {
      handleSend(query);
    },
    [handleSend],
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Messages area - scrollable */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          <MorningBriefing />
          {messages.map((msg) => (
            <ChatMessage key={msg.id} id={msg.id} role={msg.role} content={msg.content} />
          ))}
          {isLoading && (
            <div className="flex gap-3">
              <img
                src="/yojin_inverse_avatar.png"
                alt="Yojin"
                className="h-8 w-8 flex-shrink-0 rounded-full object-cover"
              />
              <div className="bg-bg-card border-border rounded-2xl rounded-tl-sm border px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <span className="bg-text-muted h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:-0.3s]" />
                  <span className="bg-text-muted h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:-0.15s]" />
                  <span className="bg-text-muted h-1.5 w-1.5 animate-bounce rounded-full" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Query builder - shown when no messages yet */}
      {messages.length === 0 && (
        <div className="px-6 pb-2">
          <div className="mx-auto max-w-3xl">
            <QueryBuilder onSelect={handleQuerySelect} />
          </div>
        </div>
      )}

      {/* Chat input - pinned bottom */}
      <div className="px-6 pb-6">
        <div className="mx-auto max-w-3xl">
          <ChatInput onSend={handleSend} disabled={isLoading} />
        </div>
      </div>
    </div>
  );
}
