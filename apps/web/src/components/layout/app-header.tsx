import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import WorldClock from './world-clock';
import { getTimezone } from '../../lib/timezone';

const segmentLabels: Record<string, string> = {
  '': 'Overview',
  chat: 'Chat',
  portfolio: 'Portfolio',
  insights: 'Insights',
  watchlist: 'Watchlist',
  skills: 'Strategies',
  profile: 'Profile',
  settings: 'Settings',
};

function HeaderClock() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1_000);
    return () => clearInterval(id);
  }, []);

  const tz = getTimezone();
  const now = new Date();

  const datePart = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(now);

  const timePart = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(now);

  return (
    <span className="text-xs tabular-nums text-text-muted">
      {datePart} &middot; {timePart}
    </span>
  );
}

export default function AppHeader() {
  const { pathname } = useLocation();
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
        {/* Live date & time */}
        <HeaderClock />

        {/* World clock trigger */}
        <button
          onClick={() => setClockOpen(true)}
          className="relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-hover hover:text-text-secondary"
        >
          <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
        </button>
      </div>

      <WorldClock open={clockOpen} onClose={() => setClockOpen(false)} />
    </header>
  );
}
