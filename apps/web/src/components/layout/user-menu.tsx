import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useTheme } from '../../lib/theme';
import type { ThemeChoice } from '../../lib/theme';
import { cn } from '../../lib/utils';
import { ONBOARDING_KEYS } from '../../lib/onboarding-context';

const themeOptions: { value: ThemeChoice; label: string; icon: string }[] = [
  {
    value: 'light',
    label: 'Light',
    icon: 'M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z',
  },
  {
    value: 'system',
    label: 'System',
    icon: 'M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25A2.25 2.25 0 0 1 5.25 3h13.5A2.25 2.25 0 0 1 21 5.25Z',
  },
  {
    value: 'dark',
    label: 'Dark',
    icon: 'M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z',
  },
];

function readPersonaName(): string {
  try {
    // Prefer the persisted name (survives onboarding state cleanup)
    const persisted = localStorage.getItem(ONBOARDING_KEYS.PERSONA_NAME_KEY);
    if (persisted) return persisted;

    // Fallback: read from in-progress onboarding state
    const raw = localStorage.getItem(ONBOARDING_KEYS.STATE_KEY);
    if (!raw) return '';
    const state = JSON.parse(raw);
    return (state?.persona?.name as string) ?? '';
  } catch {
    return '';
  }
}

export default function UserMenu() {
  const [open, setOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const personaName = readPersonaName();
  const { displayName, initials, handle } = (() => {
    const name = personaName.trim();
    if (!name) return { displayName: 'User', initials: 'U', handle: '@user' };
    const parts = name.split(/\s+/);
    const init = parts
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('');
    const hdl = '@' + name.toLowerCase().replace(/\s+/g, '');
    return { displayName: name, initials: init, handle: hdl };
  })();

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setThemeOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        setThemeOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  function goTo(path: string) {
    navigate(path);
    setOpen(false);
    setThemeOpen(false);
  }

  return (
    <div ref={menuRef} className="relative">
      {/* Avatar trigger */}
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-bg-hover"
      >
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-accent-primary/15 text-2xs font-medium text-accent-primary">
          {initials}
        </span>
        <span className="flex-1 text-left">
          <span className="block text-xs font-medium text-text-primary">{displayName}</span>
          <span className="block text-2xs text-text-muted">{handle}</span>
        </span>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-52 rounded-xl border border-border bg-bg-secondary shadow-lg shadow-black/30">
          {/* Menu items */}
          <div className="p-1.5">
            <button
              onClick={() => goTo('/profile')}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
            >
              <svg
                className="h-3.5 w-3.5 flex-shrink-0"
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

            <button
              onClick={() => goTo('/settings')}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
            >
              <svg
                className="h-3.5 w-3.5 flex-shrink-0"
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

            {/* Theme with submenu */}
            <div className="relative" onMouseEnter={() => setThemeOpen(true)} onMouseLeave={() => setThemeOpen(false)}>
              <button
                onClick={() => setThemeOpen(!themeOpen)}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
              >
                <svg
                  className="h-3.5 w-3.5 flex-shrink-0"
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
                  className="h-3.5 w-3.5 text-text-muted"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                </svg>
              </button>

              {themeOpen && (
                <div className="absolute left-full top-0 z-50 pl-2">
                  <div className="w-36 rounded-xl border border-border bg-bg-secondary p-1.5 shadow-lg shadow-black/30">
                    {themeOptions.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          setTheme(opt.value);
                          setThemeOpen(false);
                        }}
                        className={cn(
                          'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors',
                          theme === opt.value
                            ? 'bg-bg-hover text-text-primary'
                            : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                        )}
                      >
                        <svg
                          className="h-4 w-4 flex-shrink-0"
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
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
