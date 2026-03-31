import { useCallback, useRef, useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import MorningBriefing from '../components/chat/morning-briefing';
import QueryBuilder from '../components/chat/query-builder';
import WaterfallFlow from '../components/chat/waterfall-flow';
import ChatInput from '../components/chat/chat-input';
import type { ImageAttachment } from '../components/chat/chat-input';
import ChatMessage from '../components/chat/chat-message';
import ChatAvatar from '../components/chat/chat-avatar';
import CardSkeleton from '../components/chat/tool-cards/card-skeleton';
import { SessionSidebar } from '../components/chat/session-sidebar';
import { useChatContext } from '../lib/chat-context';
import { useAddPositionModal } from '../lib/add-position-modal-context';
import { usePortfolio } from '../api';
import { PageBlurGate } from '../components/common/page-blur-gate';
import Button from '../components/common/button';

/* ─── Page ─── */

export default function Chat() {
  return (
    <PageBlurGate requires="both" mockContent={<MockChatPage />}>
      <ChatContent />
    </PageBlurGate>
  );
}

/* ─── CTA banner for missing portfolio setup ─── */

/** Banner shown inside chat when AI+Jintel are configured but no positions exist. */
function ChatSetupBanner() {
  const [{ data, fetching }] = usePortfolio();
  const { openModal: openAddPosition } = useAddPositionModal();

  if (fetching) return null;

  const positions = data?.portfolio?.positions ?? [];
  if (positions.length > 0) return null;

  return (
    <div className="mx-auto mb-4 max-w-3xl">
      <div className="flex items-center gap-4 rounded-xl border border-border bg-bg-card px-5 py-4">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent-primary/10">
          <svg
            className="h-4 w-4 text-accent-primary"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-primary">Add your first position</p>
          <p className="mt-0.5 text-xs text-text-muted">
            Import positions so Yojin can provide personalized portfolio intelligence.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={openAddPosition}>
          Add Position
        </Button>
      </div>
    </div>
  );
}

function ChatContent() {
  const { messages, pendingMessages, streamingContent, isLoading, pendingToolCards, sendMessage, activeSession } =
    useChatContext();
  const { openModal: openAddPosition } = useAddPositionModal();
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
  }, [messages, isLoading, streamingContent, pendingToolCards]);

  // Reset UI state when session changes (state-during-render pattern, not an effect).
  // See: https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const sessionThreadId = activeSession.threadId;
  const [prevSessionId, setPrevSessionId] = useState(sessionThreadId);
  if (prevSessionId !== sessionThreadId) {
    setPrevSessionId(sessionThreadId);
    setActiveCategory(null);
  }

  const handleSend = useCallback(
    (content: string, image?: ImageAttachment) => {
      setActiveCategory(null);
      sendMessage(content, image);
    },
    [sendMessage],
  );

  const handleViewFullBriefing = useCallback(() => {
    sendMessage('Show me my full morning briefing');
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

  const handleWaterfallAction = useCallback(
    (action: string, displayLabel: string) => {
      setActiveCategory(null);

      // Non-tool actions (e.g. add-asset) open the add position modal
      if (action === 'add-asset') {
        openAddPosition();
        return;
      }

      // All tool actions go through the backend as real messages
      sendMessage(displayLabel);
    },
    [sendMessage, openAddPosition],
  );

  const handleWaterfallCancel = useCallback(() => {
    setActiveCategory(null);
  }, []);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Sessions sidebar */}
      <SessionSidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((prev) => !prev)} />

      {/* Main chat area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Messages area */}
        <div ref={scrollRef} className="flex-1 overflow-auto px-6 py-6">
          <div className="mx-auto max-w-3xl space-y-6">
            {/* Setup banner — shown when jintel or positions are missing */}
            {messages.length === 0 && <ChatSetupBanner />}

            {/* Morning briefing — shown only for sessions with no messages */}
            {messages.length === 0 && (
              <ChatMessage role="assistant">
                <MorningBriefing
                  date={new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                  updatedAt={`Updated ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
                  onViewFull={handleViewFullBriefing}
                />
              </ChatMessage>
            )}

            {/* Server messages (from chat context) */}
            {messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                id={msg.id}
                role={msg.role}
                content={msg.content}
                piiProtected={msg.piiProtected}
                piiTypes={msg.piiTypes}
                toolCards={msg.toolCards}
              />
            ))}

            {/* ── Active loading states ──
                 Priority: card skeletons > streaming text > subtle indicator.
                 When display tool cards are pending, show skeletons and suppress
                 streaming text (the LLM commentary is redundant with the card). */}

            {/* Card skeleton placeholders — shown as soon as a TOOL_CARD event arrives */}
            {isLoading && pendingToolCards.length > 0 && (
              <ChatMessage role="assistant">
                <div className="flex flex-col gap-3">
                  {pendingToolCards.map((card, i) => (
                    <CardSkeleton key={`${card.tool}-${i}`} tool={card.tool} />
                  ))}
                </div>
              </ChatMessage>
            )}

            {/* Streaming text — only for text-only responses (no pending tool cards) */}
            {streamingContent && pendingToolCards.length === 0 && (
              <ChatMessage id="streaming" role="assistant" content={streamingContent} streaming />
            )}

            {/* Pending queued messages — rendered after streaming so conversation order is preserved */}
            {pendingMessages.map((msg) => (
              <ChatMessage key={msg.id} role="user" content={msg.content} />
            ))}

            {/* Minimal loading indicator — before any tool cards or streaming text arrive */}
            {isLoading && pendingToolCards.length === 0 && !streamingContent && (
              <div className="flex items-start gap-3">
                <ChatAvatar />
                <div className="inline-flex items-center gap-1.5 rounded-2xl rounded-tl-sm border border-border bg-bg-card px-4 py-3">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-muted" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-muted [animation-delay:200ms]" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-muted [animation-delay:400ms]" />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Query builder / waterfall — shown when no messages */}
        {messages.length === 0 && (
          <div className="px-6 pb-4 pt-2">
            <div className="mx-auto max-w-3xl">
              {activeCategory ? (
                <WaterfallFlow
                  categoryId={activeCategory}
                  onComplete={handleWaterfallComplete}
                  onAction={handleWaterfallAction}
                  onCancel={handleWaterfallCancel}
                />
              ) : (
                <QueryBuilder onSelect={handleQuerySelect} />
              )}
            </div>
          </div>
        )}

        {/* Chat input — always visible */}
        <div className="px-6 pb-6">
          <div className="mx-auto max-w-3xl">
            <ChatInput onSend={handleSend} disableAttachment={isLoading} initialValue={presetMessage} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Mock chat page shown behind blur gate ─── */

function MockChatPage() {
  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Mock sidebar */}
      <div className="flex w-56 flex-col border-r border-border bg-bg-secondary/30 p-3">
        <div className="mb-4 rounded-lg bg-bg-tertiary px-3 py-2 text-xs text-text-muted">New Chat</div>
        <div className="space-y-1">
          {['Portfolio Analysis', 'NVDA Deep Dive', 'Risk Assessment'].map((s) => (
            <div key={s} className="rounded-lg px-3 py-2 text-xs text-text-secondary">
              {s}
            </div>
          ))}
        </div>
      </div>

      {/* Mock chat area */}
      <div className="flex flex-1 flex-col">
        <div className="flex-1 overflow-hidden px-6 py-6">
          <div className="mx-auto max-w-3xl space-y-6">
            {/* Mock briefing card */}
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 flex-shrink-0 rounded-full bg-accent-primary/20" />
              <div className="flex-1 overflow-hidden rounded-xl bg-gradient-to-br from-accent-primary/60 to-accent-primary/30 p-5">
                <div className="mb-2 flex items-center gap-2">
                  <div className="h-6 w-6 rounded-full bg-white/15" />
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-white/90">
                    Morning Briefing
                  </span>
                </div>
                <p className="font-headline text-lg text-white">Saturday, March 29</p>
                <div className="mt-4 grid grid-cols-4 gap-3">
                  {[
                    { v: '3', l: 'Actions' },
                    { v: '2', l: 'Alerts' },
                    { v: '4', l: 'Insights' },
                    { v: '58.2%', l: 'Margin' },
                  ].map((s) => (
                    <div key={s.l} className="rounded-lg bg-white/10 px-3 py-2 text-center">
                      <p className="text-sm font-bold text-white">{s.v}</p>
                      <p className="text-[10px] uppercase tracking-wider text-white/60">{s.l}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Mock user message */}
            <div className="flex justify-end">
              <div className="rounded-2xl rounded-tr-sm bg-accent-primary/20 px-4 py-2.5 text-sm text-text-primary">
                How is my portfolio performing today?
              </div>
            </div>

            {/* Mock assistant response */}
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 flex-shrink-0 rounded-full bg-accent-primary/20" />
              <div className="rounded-2xl rounded-tl-sm border border-border bg-bg-card px-4 py-3 text-sm leading-relaxed text-text-secondary">
                Your portfolio is up +1.2% today ($1,534). NVDA leads with +3.4% while AAPL is down slightly at -0.8%.
                Your overall allocation is well-balanced with 62% equities, 38% crypto.
              </div>
            </div>
          </div>
        </div>

        {/* Mock input */}
        <div className="px-6 pb-6">
          <div className="mx-auto max-w-3xl">
            <div className="rounded-xl border border-border bg-bg-card px-4 py-3 text-sm text-text-muted">
              Ask Yojin anything about your portfolio...
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
