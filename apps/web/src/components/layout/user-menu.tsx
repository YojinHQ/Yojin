import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useTheme } from '../../lib/theme';
import type { ThemeChoice } from '../../lib/theme';
import { cn } from '../../lib/utils';

export default function UserMenu() {
  const [open, setOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Close on outside click or Escape key
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setThemeOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        setThemeOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  function goTo(path: string) {
    navigate(path);
    setOpen(false);
    setThemeOpen(false);
  }

  function handleTheme(t: ThemeChoice) {
    setTheme(t);
  }

  return (
    <div ref={menuRef} className="relative border-t border-border p-2">
      {/* Popover menu */}
      {open && (
        <div className="absolute bottom-full left-2 right-2 mb-2 rounded-xl border border-border bg-bg-secondary shadow-lg shadow-black/30">
          <div className="p-1.5">
            {/* Profile */}
            <button
              onClick={() => goTo('/profile')}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
            >
              <svg
                className="w-3.5 h-3.5 flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"
                />
              </svg>
              Profile
            </button>

            {/* Settings */}
            <button
              onClick={() => goTo('/settings')}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
            >
              <svg
                className="w-3.5 h-3.5 flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
                />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
              Settings
            </button>

            {/* Theme — hover submenu */}
            <div className="relative" onMouseEnter={() => setThemeOpen(true)} onMouseLeave={() => setThemeOpen(false)}>
              <button
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
                onClick={() => setThemeOpen(!themeOpen)}
              >
                <svg
                  className="w-4 h-4 flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z"
                  />
                </svg>
                <span className="flex-1 text-left">Theme</span>
                <svg
                  className="w-3.5 h-3.5 text-text-muted"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                </svg>
              </button>

              {/* Submenu */}
              {themeOpen && (
                <div className="absolute bottom-0 left-full w-36 rounded-xl border border-border bg-bg-secondary p-1.5 shadow-lg shadow-black/30">
                  {[
                    {
                      value: 'light' as const,
                      label: 'Light',
                      icon: 'M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z',
                    },
                    {
                      value: 'system' as const,
                      label: 'System',
                      icon: 'M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25A2.25 2.25 0 0 1 5.25 3h13.5A2.25 2.25 0 0 1 21 5.25Z',
                    },
                    {
                      value: 'dark' as const,
                      label: 'Dark',
                      icon: 'M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z',
                    },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        handleTheme(opt.value);
                        setThemeOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors',
                        theme === opt.value
                          ? 'text-text-primary bg-bg-hover'
                          : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                      )}
                    >
                      <svg
                        className="w-4 h-4 flex-shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d={opt.icon} />
                      </svg>
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Divider + Log out */}
          <div className="border-t border-border p-1.5">
            <button
              onClick={() => {
                /* TODO: call signOut() */
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-error hover:bg-error/10 transition-colors"
            >
              <svg
                className="w-4 h-4 flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9"
                />
              </svg>
              Log out
            </button>
          </div>
        </div>
      )}

      {/* Trigger: user avatar row */}
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-bg-hover transition-colors"
      >
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-accent-primary/15 text-2xs font-medium text-accent-primary">
          DS
        </div>
        <div className="min-w-0 flex-1 text-left">
          <div className="truncate text-xs font-medium text-text-primary">Dean</div>
          <div className="truncate text-xs text-text-muted">@dean</div>
        </div>
        <svg
          className={cn('w-4 h-4 text-text-muted transition-transform', open && 'rotate-180')}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
        </svg>
      </button>
    </div>
  );
}
