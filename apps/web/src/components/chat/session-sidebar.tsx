import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from 'urql';
import { cn } from '../../lib/utils';
import { useChatContext } from '../../lib/chat-context';
import { SESSIONS_QUERY, CREATE_SESSION_MUTATION, DELETE_SESSION_MUTATION } from '../../lib/session-queries';

interface SessionSummary {
  id: string;
  threadId: string;
  title: string;
  createdAt: string;
  lastMessageAt: string | null;
  messageCount: number;
}

interface SessionGroup {
  label: string;
  sessions: SessionSummary[];
}

/** Group sessions into Today / Yesterday / Earlier buckets. */
function groupByDate(sessions: SessionSummary[]): SessionGroup[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86_400_000;

  const today: SessionSummary[] = [];
  const yesterday: SessionSummary[] = [];
  const earlier: SessionSummary[] = [];

  for (const s of sessions) {
    const ts = new Date(s.lastMessageAt ?? s.createdAt).getTime();
    if (ts >= todayStart) today.push(s);
    else if (ts >= yesterdayStart) yesterday.push(s);
    else earlier.push(s);
  }

  const groups: SessionGroup[] = [];
  if (today.length > 0) groups.push({ label: 'Today', sessions: today });
  if (yesterday.length > 0) groups.push({ label: 'Yesterday', sessions: yesterday });
  if (earlier.length > 0) groups.push({ label: 'Earlier', sessions: earlier });
  return groups;
}

/** Format a timestamp into a short relative/absolute label. */
function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);

  if (diffMins < 1) return 'Now';
  if (diffMins < 60) return `${diffMins}m`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ── Icons ─────────────────────────────────────────────────────────── */

function ChatBubbleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z"
      />
    </svg>
  );
}

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z"
      />
    </svg>
  );
}

interface SessionSidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

export function SessionSidebar({ collapsed = false, onToggle }: SessionSidebarProps) {
  const { activeSession, switchSession, sessionVersion } = useChatContext();
  const [{ data, fetching }, reexecuteQuery] = useQuery<{ sessions: SessionSummary[] }>({
    query: SESSIONS_QUERY,
    requestPolicy: 'cache-and-network',
  });
  const [, createSession] = useMutation(CREATE_SESSION_MUTATION);
  const [, deleteSession] = useMutation(DELETE_SESSION_MUTATION);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Refetch session list when a message exchange completes (new session may have been created,
  // message counts may have changed, titles may have updated)
  const prevVersionRef = useRef(sessionVersion);
  useEffect(() => {
    if (sessionVersion !== prevVersionRef.current) {
      prevVersionRef.current = sessionVersion;
      reexecuteQuery({ requestPolicy: 'network-only' });
    }
  }, [sessionVersion, reexecuteQuery]);

  const sessions = data?.sessions ?? [];
  const groups = groupByDate(sessions);

  const handleNewSession = useCallback(async () => {
    const result = await createSession({});
    if (result.data?.createSession) {
      switchSession(null, result.data.createSession.threadId);
    } else {
      // Fallback: start a new local session even if backend fails
      switchSession(null);
    }
    // Refresh sidebar to show the newly created session
    reexecuteQuery({ requestPolicy: 'network-only' });
  }, [switchSession, createSession, reexecuteQuery]);

  const handleSelectSession = useCallback(
    (session: SessionSummary) => {
      // If clicking the currently active session, do nothing
      if (session.threadId === activeSession.threadId) return;
      switchSession(session.id, session.threadId);
    },
    [switchSession, activeSession],
  );

  const handleDeleteSession = useCallback(
    async (e: React.MouseEvent, sessionId: string) => {
      e.stopPropagation();
      setDeletingId(sessionId);
      const result = await deleteSession({ id: sessionId });
      if (result.error) {
        setDeletingId(null);
        console.error('Failed to delete session:', result.error);
        return;
      }
      // If we deleted the currently viewed session, start fresh
      if (activeSession.sessionId === sessionId) {
        switchSession(null);
      }
      setDeletingId(null);
      // Refresh sidebar to remove the deleted session
      reexecuteQuery({ requestPolicy: 'network-only' });
    },
    [deleteSession, activeSession.sessionId, switchSession, reexecuteQuery],
  );

  /* ── Collapsed state ──────────────────────────────────────────────── */

  if (collapsed) {
    return (
      <div className="flex w-10 flex-col items-center gap-2 border-r border-border bg-bg-secondary py-3">
        <button
          onClick={onToggle}
          className="cursor-pointer rounded-md p-1.5 text-text-secondary hover:bg-bg-hover hover:text-text-primary"
          title="Show sessions"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <button
          onClick={handleNewSession}
          className="cursor-pointer rounded-md p-1.5 text-text-secondary hover:bg-bg-hover hover:text-accent-primary"
          title="New conversation"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>
    );
  }

  /* ── Expanded state ───────────────────────────────────────────────── */

  return (
    <div className="flex w-64 flex-col border-r border-border bg-bg-secondary">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-3">
        <div className="flex items-center gap-2">
          <ChatBubbleIcon className="h-4 w-4 text-text-muted" />
          <span className="text-xs font-medium text-text-secondary">Sessions</span>
          {sessions.length > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-bg-tertiary px-1 text-[10px] font-medium text-text-muted">
              {sessions.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleNewSession}
            className="cursor-pointer rounded-md p-1.5 text-text-secondary transition-colors hover:bg-accent-glow hover:text-accent-primary"
            title="New conversation"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
          {onToggle && (
            <button
              onClick={onToggle}
              className="cursor-pointer rounded-md p-1.5 text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
              title="Hide sessions"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-2 py-2.5">
        {/* Loading state */}
        {fetching && sessions.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-text-muted border-t-accent-primary" />
          </div>
        )}

        {/* Empty state */}
        {!fetching && sessions.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-3 py-10">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-bg-tertiary">
              <SparkleIcon className="h-5 w-5 text-text-muted" />
            </div>
            <div className="text-center">
              <p className="text-xs font-medium text-text-secondary">No conversations yet</p>
              <p className="mt-0.5 text-2xs text-text-muted">Start one to see it here</p>
            </div>
          </div>
        )}

        {/* Grouped sessions */}
        {groups.map((group) => (
          <div key={group.label} className="mb-4">
            <div className="mb-1.5 flex items-center gap-2 px-1">
              <span className="text-2xs font-semibold uppercase tracking-widest text-text-muted">{group.label}</span>
              <span className="h-px flex-1 bg-border/50" />
            </div>

            <div className="space-y-1.5">
              {group.sessions.map((session) => {
                const isActive = session.threadId === activeSession.threadId;
                const timeLabel = formatTime(session.lastMessageAt ?? session.createdAt);

                return (
                  <div
                    key={session.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelectSession(session)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSelectSession(session);
                      }
                    }}
                    className={cn(
                      'group flex w-full cursor-pointer items-start gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-all',
                      isActive
                        ? 'border-accent-primary/30 bg-accent-glow text-text-primary ring-1 ring-accent-primary/20'
                        : 'border-border bg-bg-card hover:border-border-light hover:bg-bg-tertiary',
                    )}
                  >
                    {/* Icon */}
                    <div
                      className={cn(
                        'mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg',
                        isActive ? 'bg-accent-primary/10' : 'bg-bg-tertiary',
                      )}
                    >
                      <ChatBubbleIcon
                        className={cn('h-3.5 w-3.5', isActive ? 'text-accent-primary' : 'text-text-muted')}
                      />
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {isActive && (
                          <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-accent-primary" />
                        )}
                        <span
                          className={cn(
                            'truncate text-xs font-medium',
                            isActive ? 'text-text-primary' : 'text-text-secondary',
                          )}
                        >
                          {session.title}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-2xs text-text-muted">
                        <span>
                          {session.messageCount} msg{session.messageCount !== 1 ? 's' : ''}
                        </span>
                        <span className="text-border-light">&middot;</span>
                        <span>{timeLabel}</span>
                      </div>
                    </div>

                    {/* Delete button — hidden by default, shown on hover */}
                    <button
                      onClick={(e) => handleDeleteSession(e, session.id)}
                      className={cn(
                        'mt-0.5 flex-shrink-0 cursor-pointer rounded-md p-1 text-text-muted opacity-0 transition-all hover:bg-error/10 hover:text-error group-hover:opacity-100',
                        deletingId === session.id && 'animate-pulse opacity-100',
                      )}
                      title="Delete session"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
