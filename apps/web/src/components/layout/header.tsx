import { useLocation, useSearchParams } from 'react-router';
import { cn } from '../../lib/utils';

const pathToTitle: Record<string, string> = {
  '/': 'Overview',
  '/chat': 'Chat',
  '/portfolio': 'Portfolio',
  '/skills': 'Skills',
  '/profile': 'Profile',
  '/settings': 'Settings',
};

function getTitle(pathname: string): string {
  // Exact match first
  if (pathToTitle[pathname]) return pathToTitle[pathname];
  // Handle /portfolio/:symbol
  if (pathname.startsWith('/portfolio/')) return 'Portfolio';
  return 'Yojin';
}

export default function Header() {
  const location = useLocation();
  const title = getTitle(location.pathname);
  const isSkills = location.pathname === '/skills';
  const [searchParams, setSearchParams] = useSearchParams();
  const skillsView = searchParams.get('view') === 'builder' ? 'builder' : 'active';

  return (
    <header className="flex items-center justify-between border-b border-border bg-bg-secondary px-4 py-2">
      <h1 className="font-headline text-base text-text-primary">{title}</h1>

      <div className="flex items-center gap-4">
        {isSkills && (
          <div className="flex gap-1 rounded-lg bg-bg-tertiary p-1">
            <button
              onClick={() => setSearchParams({})}
              className={cn(
                'rounded-md px-3 py-1 text-sm transition-colors',
                skillsView === 'active' ? 'bg-bg-hover text-text-primary' : 'text-text-muted hover:text-text-secondary',
              )}
            >
              Active
            </button>
            <button
              onClick={() => setSearchParams({ view: 'builder' })}
              className={cn(
                'rounded-md px-3 py-1 text-sm transition-colors',
                skillsView === 'builder'
                  ? 'bg-bg-hover text-text-primary'
                  : 'text-text-muted hover:text-text-secondary',
              )}
            >
              Builder
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
