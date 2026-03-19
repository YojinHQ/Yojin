import { useCallback, useRef, useEffect } from 'react';
import MorningBriefing from '../components/chat/morning-briefing';
import QueryBuilder from '../components/chat/query-builder';
import ChatInput from '../components/chat/chat-input';
import ChatMessage from '../components/chat/chat-message';
import { useChatContext } from '../lib/chat-context';

export default function Chat() {
  const { messages, streamingContent, isLoading, isThinking, activeTools, sendMessage } = useChatContext();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading, streamingContent, isThinking, activeTools]);

  const handleQuerySelect = useCallback(
    (query: string) => {
      sendMessage(query);
    },
    [sendMessage],
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          <MorningBriefing />
          {messages.map((msg) => (
            <ChatMessage
              key={msg.id}
              id={msg.id}
              role={msg.role}
              content={msg.content}
              piiProtected={msg.piiProtected}
              piiTypes={msg.piiTypes}
            />
          ))}

          {/* Streaming response */}
          {streamingContent && <ChatMessage id="streaming" role="assistant" content={streamingContent} />}

          {/* Thinking indicator */}
          {isLoading && !streamingContent && (
            <div className="flex gap-3">
              <img
                src="/yojin_inverse_avatar.png"
                alt="Yojin"
                className="h-8 w-8 flex-shrink-0 rounded-full object-cover"
              />
              <div className="flex flex-col gap-2">
                {isThinking && (
                  <div className="bg-bg-card border-border inline-flex items-center gap-2 rounded-full border px-3 py-1.5">
                    <div className="flex items-center gap-1">
                      <span className="bg-accent-primary h-1.5 w-1.5 animate-pulse rounded-full" />
                      <span className="bg-accent-primary h-1.5 w-1.5 animate-pulse rounded-full [animation-delay:0.2s]" />
                      <span className="bg-accent-primary h-1.5 w-1.5 animate-pulse rounded-full [animation-delay:0.4s]" />
                    </div>
                    <span className="text-text-secondary text-xs">Thinking</span>
                  </div>
                )}

                {activeTools.map((tool, i) => (
                  <div
                    key={`${tool}-${i}`}
                    className="bg-bg-card border-border inline-flex items-center gap-2 rounded-full border px-3 py-1.5"
                  >
                    <svg className="text-accent-primary h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    <span className="text-text-secondary text-xs font-mono">{tool}</span>
                  </div>
                ))}

                {!isThinking && activeTools.length === 0 && (
                  <div className="bg-bg-card border-border rounded-2xl rounded-tl-sm border px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="bg-text-muted h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:-0.3s]" />
                      <span className="bg-text-muted h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:-0.15s]" />
                      <span className="bg-text-muted h-1.5 w-1.5 animate-bounce rounded-full" />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Query builder */}
      {messages.length === 0 && (
        <div className="px-6 pb-2">
          <div className="mx-auto max-w-3xl">
            <QueryBuilder onSelect={handleQuerySelect} />
          </div>
        </div>
      )}

      {/* Chat input */}
      <div className="px-6 pb-6">
        <div className="mx-auto max-w-3xl">
          <ChatInput onSend={sendMessage} />
        </div>
      </div>
    </div>
  );
}
