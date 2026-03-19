import { useCallback, useRef, useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import MorningBriefing from '../components/chat/morning-briefing';
import FullBriefingCard from '../components/chat/full-briefing-card';
import QueryBuilder from '../components/chat/query-builder';
import WaterfallFlow from '../components/chat/waterfall-flow';
import ChatInput from '../components/chat/chat-input';
import type { ImageAttachment } from '../components/chat/chat-input';
import ChatMessage from '../components/chat/chat-message';
import ChatAvatar from '../components/chat/chat-avatar';
import { useChatContext } from '../lib/chat-context';

/* ─── Message types for local-only UI messages (briefings, rich cards) ─── */

interface BriefingMessage {
  id: string;
  role: 'assistant';
  type: 'briefing';
}

type LocalMessage = BriefingMessage;

/* ─── Page ─── */

export default function Chat() {
  const { messages, streamingContent, isLoading, isThinking, activeTools, sendMessage } = useChatContext();
  const [localMessages, setLocalMessages] = useState<LocalMessage[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();

  // Read preset message from location state (e.g. from "Add to Chat" on intel cards)
  const [presetMessage] = useState<string | undefined>(() => (location.state as { preset?: string } | null)?.preset);

  // Clear location state so refreshing doesn't re-populate
  useEffect(() => {
    if (presetMessage) {
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [presetMessage, navigate, location.pathname]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, localMessages, isLoading, streamingContent, isThinking, activeTools]);

  const handleSend = useCallback(
    (content: string, image?: ImageAttachment) => {
      setActiveCategory(null);
      sendMessage(content, image);
    },
    [sendMessage],
  );

  const handleViewFullBriefing = useCallback(() => {
    // Send user message through the real chat context
    sendMessage('Show me my full morning briefing');
    // Add a local briefing card
    const briefingMsg: BriefingMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      type: 'briefing',
    };
    setLocalMessages((prev) => [...prev, briefingMsg]);
  }, [sendMessage]);

  const handleQuerySelect = useCallback((categoryId: string) => {
    setActiveCategory(categoryId);
  }, []);

  const handleWaterfallComplete = useCallback(
    (query: string) => {
      setActiveCategory(null);
      sendMessage(query);
    },
    [sendMessage],
  );

  const handleWaterfallCancel = useCallback(() => {
    setActiveCategory(null);
  }, []);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* Morning briefing — always shown as first AI message */}
          <ChatMessage role="assistant">
            <MorningBriefing
              date={new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              updatedAt={`Updated ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
              onViewFull={handleViewFullBriefing}
            />
          </ChatMessage>

          {/* Server messages (from chat context) */}
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

          {/* Local-only messages (briefing rich cards) */}
          {localMessages.map((msg) => (
            <ChatMessage key={msg.id} role="assistant">
              <FullBriefingCard />
            </ChatMessage>
          ))}

          {/* Streaming response */}
          {streamingContent && <ChatMessage id="streaming" role="assistant" content={streamingContent} />}

          {/* Loading / thinking / tool indicators */}
          {isLoading && !streamingContent && (
            <div className="flex items-start gap-3">
              <ChatAvatar />
              <div className="flex flex-col gap-2">
                {isThinking && (
                  <div className="inline-flex items-center gap-2 rounded-full border border-border bg-bg-card px-3 py-1.5">
                    <div className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-primary" />
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-primary [animation-delay:0.2s]" />
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-primary [animation-delay:0.4s]" />
                    </div>
                    <span className="text-xs text-text-secondary">Thinking</span>
                  </div>
                )}

                {activeTools.map((tool, i) => (
                  <div
                    key={`${tool}-${i}`}
                    className="inline-flex items-center gap-2 rounded-full border border-border bg-bg-card px-3 py-1.5"
                  >
                    <svg className="h-3.5 w-3.5 animate-spin text-accent-primary" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    <span className="font-mono text-xs text-text-secondary">{tool}</span>
                  </div>
                ))}

                {!isThinking && activeTools.length === 0 && (
                  <div className="rounded-2xl rounded-tl-sm border border-border bg-bg-card px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted [animation-delay:-0.3s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted [animation-delay:-0.15s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted" />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Query builder / waterfall — shown when no user messages */}
      {messages.length === 0 && (
        <div className="px-6 pb-4 pt-2">
          <div className="mx-auto max-w-3xl">
            {activeCategory ? (
              <WaterfallFlow
                categoryId={activeCategory}
                onComplete={handleWaterfallComplete}
                onCancel={handleWaterfallCancel}
              />
            ) : (
              <QueryBuilder onSelect={handleQuerySelect} />
            )}
          </div>
        </div>
      )}

      {/* Chat input — pinned bottom */}
      <div className="px-6 pb-6">
        <div className="mx-auto max-w-3xl">
          <ChatInput onSend={handleSend} disabled={isLoading} initialValue={presetMessage} />
        </div>
      </div>
    </div>
  );
}
