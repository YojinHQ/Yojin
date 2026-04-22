import { useState, useRef, useEffect, useMemo } from 'react';
import { cn } from '../../lib/utils';

const TIMEZONES = [
  // Americas
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'America/Bogota',
  'America/Lima',
  // Europe
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Zurich',
  'Europe/Stockholm',
  'Europe/Helsinki',
  'Europe/Moscow',
  'Europe/Istanbul',
  // Asia
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Singapore',
  'Asia/Seoul',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Taipei',
  'Asia/Bangkok',
  // Oceania
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Perth',
  'Pacific/Auckland',
  // Africa
  'Africa/Johannesburg',
  'Africa/Cairo',
  'Africa/Lagos',
];

function getRegion(tz: string): string {
  const prefix = tz.split('/')[0];
  if (prefix === 'America') return 'Americas';
  if (prefix === 'Pacific') return tz.includes('Auckland') ? 'Oceania' : 'Americas';
  if (prefix === 'Australia') return 'Oceania';
  return prefix;
}

function formatCity(tz: string): string {
  return (tz.split('/').pop() ?? tz).replace(/_/g, ' ');
}

function getOffset(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date());
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

interface TimezonePickerProps {
  value: string;
  onChange: (tz: string) => void;
}

export function TimezonePicker({ value, onChange }: TimezonePickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchResetTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      if (searchResetTimeoutRef.current) clearTimeout(searchResetTimeoutRef.current);
      searchResetTimeoutRef.current = setTimeout(() => {
        setSearch('');
        inputRef.current?.focus();
      }, 0);
    }
    return () => {
      if (searchResetTimeoutRef.current) clearTimeout(searchResetTimeoutRef.current);
    };
  }, [open]);

  const grouped = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = TIMEZONES.filter((tz) => {
      if (!q) return true;
      return tz.toLowerCase().includes(q) || formatCity(tz).toLowerCase().includes(q);
    });

    const groups: Record<string, string[]> = {};
    for (const tz of filtered) {
      const region = getRegion(tz);
      (groups[region] ??= []).push(tz);
    }
    return groups;
  }, [search]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'cursor-pointer flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors',
          'border-border bg-bg-tertiary text-text-secondary hover:border-accent-primary/30 hover:bg-bg-hover/50 hover:text-text-primary',
        )}
      >
        <svg
          className="h-3.5 w-3.5 text-text-muted"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418"
          />
        </svg>
        <span>{formatCity(value)}</span>
        <span className="text-2xs text-text-muted">{getOffset(value)}</span>
        <svg
          className={cn('h-3 w-3 text-text-muted transition-transform', open && 'rotate-180')}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-xl border border-border bg-bg-secondary shadow-lg shadow-black/30">
          <div className="p-2">
            <input
              ref={inputRef}
              type="text"
              placeholder="Search timezones..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
            />
          </div>
          <div className="max-h-60 overflow-y-auto px-1.5 pb-1.5">
            {Object.entries(grouped).map(([region, tzs]) => (
              <div key={region}>
                <div className="px-2 py-1 text-2xs font-medium uppercase tracking-wider text-text-muted">{region}</div>
                {tzs.map((tz) => (
                  <button
                    key={tz}
                    type="button"
                    onClick={() => {
                      onChange(tz);
                      setOpen(false);
                    }}
                    className={cn(
                      'cursor-pointer flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm transition-colors',
                      tz === value
                        ? 'bg-accent-primary/10 text-accent-primary'
                        : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                    )}
                  >
                    <span>{formatCity(tz)}</span>
                    <span className="text-2xs text-text-muted">{getOffset(tz)}</span>
                  </button>
                ))}
              </div>
            ))}
            {Object.keys(grouped).length === 0 && (
              <div className="px-2 py-3 text-center text-sm text-text-muted">No timezones found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
