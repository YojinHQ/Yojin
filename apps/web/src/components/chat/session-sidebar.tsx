import { useCallback, useState } from 'react';
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

interface SessionSidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

export default function SessionSidebar({ collapsed = false, onToggle }: SessionSidebarProps) {
  const { activeSession, switchSession } = useChatContext();
  const [{ data, fetching }] = useQuery<{ sessions: SessionSummary[] }>({
    query: SESSIONS_QUERY,
  });
  const [, createSession] = useMutation(CREATE_SESSION_MUTATION);
  const [, deleteSession] = useMutation(DELETE_SESSION_MUTATION);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const sessions = data?.sessions ?? [];
  const groups = groupByDate(sessions);

  const handleNewSession = useCallback(async () => {
    switchSession(null);
    await createSession({});
  }, [switchSession, createSession]);

  const handleSelectSession = useCallback(
    (session: SessionSummary) => {
      // If clicking the currently active live session, do nothing
      if (session.threadId === activeSession.threadId && !activeSession.isReadOnly) return;
      switchSession(session.id, session.threadId);
    },
    [switchSession, activeSession],
  );

  const handleDeleteSession = useCallback(
    async (e: React.MouseEvent, sessionId: string) => {
      e.stopPropagation();
      setDeletingId(sessionId);
      await deleteSession({ id: sessionId });
      // If we deleted the currently viewed session, start fresh
      if (activeSession.sessionId === sessionId) {
        switchSession(null);
      }
      setDeletingId(null);
    },
    [deleteSession, activeSession.sessionId, switchSession],
  );

  if (collapsed) {
    return (
      <div className="flex w-10 flex-col items-center border-r border-border bg-bg-secondary py-3">
        <button
          onClick={onToggle}
          className="cursor-pointer rounded-md p-1.5 text-text-secondary hover:bg-bg-hover hover:text-text-primary"
          title="Show sessions"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-64 flex-col border-r border-border bg-bg-secondary">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-3">
        <span className="text-xs font-medium text-text-secondary">Sessions</span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleNewSession}
            className="cursor-pointer rounded-md p-1 text-text-secondary hover:bg-bg-hover hover:text-text-primary"
            title="New conversation"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
          {onToggle && (
            <button
              onClick={onToggle}
              className="cursor-pointer rounded-md p-1 text-text-secondary hover:bg-bg-hover hover:text-text-primary"
              title="Hide sessions"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {fetching && sessions.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-text-muted border-t-accent-primary" />
          </div>
        )}

        {!fetching && sessions.length === 0 && (
          <div className="px-2 py-8 text-center text-xs text-text-muted">No conversations yet</div>
        )}

        {groups.map((group) => (
          <div key={group.label} className="mb-3">
            <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              {group.label}
            </div>
            {group.sessions.map((session) => {
              const isActive = session.threadId === activeSession.threadId && !activeSession.isReadOnly;
              const isViewing = activeSession.sessionId === session.id && activeSession.isReadOnly;

              return (
                <button
                  key={session.id}
                  onClick={() => handleSelectSession(session)}
                  className={cn(
                    'group flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors',
                    isActive
                      ? 'bg-accent-glow text-accent-secondary'
                      : isViewing
                        ? 'bg-bg-hover text-text-primary'
                        : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {isActive && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-primary" />}
                      <span className="truncate text-xs">{session.title}</span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-text-muted">
                      {session.messageCount} message{session.messageCount !== 1 ? 's' : ''}
                    </div>
                  </div>

                  {/* Delete button — hidden by default, shown on hover */}
                  <button
                    onClick={(e) => handleDeleteSession(e, session.id)}
                    className={cn(
                      'flex-shrink-0 cursor-pointer rounded p-0.5 text-text-muted opacity-0 transition-opacity hover:text-error group-hover:opacity-100',
                      deletingId === session.id && 'animate-pulse opacity-100',
                    )}
                    title="Delete session"
                  >
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
