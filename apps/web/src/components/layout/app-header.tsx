import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useChatPanel } from '../../lib/chat-panel-context';
import WorldClock from './world-clock';
import NotificationsCenter from './notifications-center';

const segmentLabels: Record<string, string> = {
  '': 'Overview',
  chat: 'Chat',
  portfolio: 'Portfolio',
  skills: 'Skills',
  profile: 'Profile',
  settings: 'Settings',
};

export default function AppHeader() {
  const { pathname } = useLocation();
  const { isOpen, toggleChat } = useChatPanel();
  const [clockOpen, setClockOpen] = useState(false);

  // Build breadcrumbs from path segments
  const segments = pathname.split('/').filter(Boolean);
  const crumbs: { label: string; path: string }[] = [
    { label: segmentLabels[segments[0] ?? ''] ?? 'Overview', path: segments[0] ? `/${segments[0]}` : '/' },
  ];

  // Add deeper segments (e.g. /portfolio/AAPL → Portfolio › AAPL)
  if (segments.length > 1) {
    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i];
      crumbs.push({
        label: segmentLabels[seg] ?? seg.toUpperCase(),
        path: '/' + segments.slice(0, i + 1).join('/'),
      });
    }
  }

  return (
    <header className="flex h-12 flex-shrink-0 items-center justify-between border-b border-border bg-bg-secondary px-5">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 text-sm">
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <span key={crumb.path} className="flex items-center gap-1.5">
              {i > 0 && (
                <svg
                  className="h-3 w-3 text-text-muted"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                </svg>
              )}
              {isLast ? (
                <span className="font-medium text-text-primary">{crumb.label}</span>
              ) : (
                <Link to={crumb.path} className="text-text-muted transition-colors hover:text-text-secondary">
                  {crumb.label}
                </Link>
              )}
            </span>
          );
        })}
      </nav>

      <div className="flex items-center gap-3">
        {/* World clock trigger */}
        <button
          onClick={() => setClockOpen(true)}
          className="relative flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-hover hover:text-text-secondary"
        >
          <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
        </button>

        {/* Divider */}
        <div className="h-4 w-px bg-border" />

        <NotificationsCenter />

        {/* Chat toggle — shows when chat is collapsed */}
        {!isOpen && (
          <>
            <div className="h-4 w-px bg-border" />
            <button
              onClick={toggleChat}
              className="relative flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-hover hover:text-text-secondary"
              title="Open chat"
            >
              <svg
                className="h-[18px] w-[18px]"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z"
                />
              </svg>
            </button>
          </>
        )}
      </div>

      <WorldClock open={clockOpen} onClose={() => setClockOpen(false)} />
    </header>
  );
}
