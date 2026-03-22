/**
 * Global chat panel — always-on right panel, native part of the app layout.
 *
 * Uses the shared ChatProvider context for state, so conversations
 * persist as the user navigates between pages.
 */

import { useCallback, useEffect, useRef } from 'react';

import { useChatContext } from '../../lib/chat-context';
import { useChatPanel } from '../../lib/chat-panel-context';
import ChatAvatar from './chat-avatar';
import ChatInput from './chat-input';
import type { ImageAttachment } from './chat-input';
import ChatMessage from './chat-message';

export default function ChatPanel() {
  const { messages, pendingMessages, streamingContent, isLoading, isThinking, activeTools, sendMessage } =
    useChatContext();
  const { mode, isOpen, presetMessage, consumePreset, toggleChat, setMode } = useChatPanel();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent, isThinking, activeTools]);

  // Auto-send preset message
  useEffect(() => {
    if (presetMessage) {
      sendMessage(presetMessage);
      consumePreset();
    }
  }, [presetMessage, sendMessage, consumePreset]);

  const handleSend = useCallback(
    (content: string, image?: ImageAttachment) => {
      sendMessage(content, image);
    },
    [sendMessage],
  );

  const isFull = mode === 'full';

  return (
    <div
      className={`flex flex-col border-l border-border bg-bg-primary transition-[width,min-width] duration-300 ease-in-out ${
        isFull ? 'flex-1' : isOpen ? 'w-[380px] min-w-[380px]' : 'w-0 min-w-0'
      } overflow-hidden`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
        <div className="flex items-center gap-2">
          <ChatAvatar className="h-7 w-7 text-xs" />
          <span className="text-sm font-medium text-text-primary">Yojin AI</span>
          {isLoading && (
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-primary" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-primary [animation-delay:0.2s]" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-primary [animation-delay:0.4s]" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Expand / shrink */}
          <button
            onClick={() => setMode(isFull ? 'panel' : 'full')}
            className="rounded-lg p-1.5 text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
            title={isFull ? 'Shrink to panel' : 'Expand to full page'}
          >
            {isFull ? (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25"
                />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"
                />
              </svg>
            )}
          </button>
          {/* Collapse to hidden */}
          <button
            onClick={toggleChat}
            className="rounded-lg p-1.5 text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
            title="Collapse chat"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-4 py-4">
        <div className="space-y-4">
          {messages.length === 0 && !isLoading && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ChatAvatar className="h-12 w-12 text-lg" />
              <p className="mt-3 text-sm font-medium text-text-primary">How can I help?</p>
              <p className="mt-1 text-xs text-text-muted">Ask about your portfolio, market data, or anything else.</p>
            </div>
          )}

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

          {/* Streaming */}
          {streamingContent && <ChatMessage id="streaming" role="assistant" content={streamingContent} />}

          {/* Pending */}
          {pendingMessages.map((msg) => (
            <ChatMessage key={msg.id} role="user" content={msg.content} />
          ))}

          {/* Loading indicators */}
          {isLoading && !streamingContent && (
            <div className="flex items-start gap-2">
              <ChatAvatar className="h-7 w-7 text-xs" />
              <div className="flex flex-col gap-1.5">
                {isThinking && (
                  <div className="inline-flex items-center gap-2 rounded-full border border-border bg-bg-card px-3 py-1">
                    <div className="flex items-center gap-1">
                      <span className="h-1 w-1 animate-pulse rounded-full bg-accent-primary" />
                      <span className="h-1 w-1 animate-pulse rounded-full bg-accent-primary [animation-delay:0.2s]" />
                      <span className="h-1 w-1 animate-pulse rounded-full bg-accent-primary [animation-delay:0.4s]" />
                    </div>
                    <span className="text-2xs text-text-secondary">Thinking</span>
                  </div>
                )}

                {activeTools.map((tool, i) => (
                  <div
                    key={`${tool}-${i}`}
                    className="inline-flex items-center gap-2 rounded-full border border-border bg-bg-card px-3 py-1"
                  >
                    <svg className="h-3 w-3 animate-spin text-accent-primary" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    <span className="font-mono text-2xs text-text-secondary">{tool}</span>
                  </div>
                ))}

                {!isThinking && activeTools.length === 0 && (
                  <div className="rounded-xl rounded-tl-sm border border-border bg-bg-card px-3 py-2">
                    <div className="flex items-center gap-1">
                      <span className="h-1 w-1 animate-bounce rounded-full bg-text-muted [animation-delay:-0.3s]" />
                      <span className="h-1 w-1 animate-bounce rounded-full bg-text-muted [animation-delay:-0.15s]" />
                      <span className="h-1 w-1 animate-bounce rounded-full bg-text-muted" />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-border px-4 py-3 shrink-0">
        <ChatInput onSend={handleSend} disableAttachment={isLoading} placeholder="Ask Yojin..." />
      </div>
    </div>
  );
}
