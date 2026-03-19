import { useState, useEffect } from 'react';
import Modal from '../common/modal';
import { cn } from '../../lib/utils';

interface Market {
  city: string;
  exchange: string;
  timezone: string;
  /** Trading hours as [openMinutes, closeMinutes] from midnight local time */
  hours: [number, number];
  flag: string;
  /** Pre-market hours (US markets only) */
  preMarketHours?: [number, number];
  /** Extended / after-hours trading (US markets only) */
  afterHoursRange?: [number, number];
}

const MARKETS: Market[] = [
  {
    city: 'New York',
    exchange: 'NYSE',
    timezone: 'America/New_York',
    hours: [570, 960],
    flag: '🇺🇸',
    preMarketHours: [240, 570],
    afterHoursRange: [960, 1200],
  },
  { city: 'London', exchange: 'LSE', timezone: 'Europe/London', hours: [480, 990], flag: '🇬🇧' },
  { city: 'Frankfurt', exchange: 'XETRA', timezone: 'Europe/Berlin', hours: [540, 1050], flag: '🇩🇪' },
  { city: 'Tokyo', exchange: 'TSE', timezone: 'Asia/Tokyo', hours: [540, 900], flag: '🇯🇵' },
  { city: 'Hong Kong', exchange: 'HKEX', timezone: 'Asia/Hong_Kong', hours: [570, 960], flag: '🇭🇰' },
  { city: 'Sydney', exchange: 'ASX', timezone: 'Australia/Sydney', hours: [600, 960], flag: '🇦🇺' },
];

type Phase = 'pre-market' | 'open' | 'after-hours' | 'closed';

interface ClockData {
  time: string;
  date: string;
  phase: Phase;
  minutesInDay: number;
  countdown: string;
}

/* ── Helpers ─────────────────────────────────── */

function getClockData(market: Market): ClockData {
  const now = new Date();
  const { timezone, hours, preMarketHours, afterHoursRange } = market;

  const timeFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const dateFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  const parts = timeFmt.formatToParts(now).reduce<Record<string, string>>((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});

  const dayParts = dateFmt.formatToParts(now).reduce<Record<string, string>>((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});

  const h = parseInt(parts.hour, 10);
  const m = parseInt(parts.minute, 10);
  const minutesInDay = h * 60 + m;
  const day = dayParts.weekday;
  const isWeekend = day === 'Sat' || day === 'Sun';

  // Determine session phase
  let phase: Phase = 'closed';
  if (!isWeekend) {
    if (minutesInDay >= hours[0] && minutesInDay < hours[1]) {
      phase = 'open';
    } else if (preMarketHours && minutesInDay >= preMarketHours[0] && minutesInDay < preMarketHours[1]) {
      phase = 'pre-market';
    } else if (afterHoursRange && minutesInDay >= afterHoursRange[0] && minutesInDay < afterHoursRange[1]) {
      phase = 'after-hours';
    }
  }

  const countdown = computeCountdown(minutesInDay, hours, phase, isWeekend);

  return {
    time: timeFmt.format(now),
    date: dateFmt.format(now),
    phase,
    minutesInDay,
    countdown,
  };
}

function computeCountdown(minutesInDay: number, hours: [number, number], phase: Phase, isWeekend: boolean): string {
  if (isWeekend) return 'Opens Monday';

  if (phase === 'open') {
    return fmtDuration(hours[1] - minutesInDay, 'Closes');
  }

  if (phase === 'pre-market' || minutesInDay < hours[0]) {
    return fmtDuration(hours[0] - minutesInDay, 'Opens');
  }

  if (phase === 'after-hours') {
    return `Opens tomorrow ${formatHour(hours[0])}`;
  }

  return `Opens ${formatHour(hours[0])}`;
}

function fmtDuration(totalMinutes: number, prefix: string): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${prefix} in ${h}h ${m}m` : `${prefix} in ${m}m`;
}

/** Progress through the trading day as 0–1 (clamped). */
function tradingProgress(minutesInDay: number, hours: [number, number]): number {
  const [open, close] = hours;
  if (minutesInDay <= open) return 0;
  if (minutesInDay >= close) return 1;
  return (minutesInDay - open) / (close - open);
}

function formatHour(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/* ── Phase visual config ─────────────────────── */

const PHASE_STYLES: Record<
  Phase,
  { label: string; dot: string; badge: string; accent: string; bar: string; countdown: string; glow: string }
> = {
  open: {
    label: 'Open',
    dot: 'bg-success animate-pulse',
    badge: 'bg-success/15 text-success',
    accent: 'var(--color-success)',
    bar: 'bg-success',
    countdown: 'text-success',
    glow: '0 0 24px -4px rgba(91,185,140,0.18)',
  },
  'pre-market': {
    label: 'Pre-Market',
    dot: 'bg-warning animate-pulse',
    badge: 'bg-warning/15 text-warning',
    accent: 'var(--color-warning)',
    bar: 'bg-warning/60',
    countdown: 'text-warning',
    glow: '0 0 24px -4px rgba(212,163,74,0.12)',
  },
  'after-hours': {
    label: 'After Hours',
    dot: 'bg-market animate-pulse',
    badge: 'bg-market/15 text-market',
    accent: 'var(--color-market)',
    bar: 'bg-market/60',
    countdown: 'text-market',
    glow: '0 0 24px -4px rgba(167,139,250,0.12)',
  },
  closed: {
    label: 'Closed',
    dot: 'bg-text-muted',
    badge: 'bg-text-muted/10 text-text-muted',
    accent: 'transparent',
    bar: 'bg-text-muted/20',
    countdown: 'text-text-muted',
    glow: 'none',
  },
};

/* ── Component ───────────────────────────────── */

interface WorldClockProps {
  open: boolean;
  onClose: () => void;
}

export default function WorldClock({ open, onClose }: WorldClockProps) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setTick((t) => t + 1), 1_000);
    return () => clearInterval(id);
  }, [open]);

  // tick drives re-render each second
  void tick;

  const entries = MARKETS.map((market) => {
    const clock = getClockData(market);
    const progress = tradingProgress(clock.minutesInDay, market.hours);
    return { market, clock, progress };
  });

  const openCount = entries.filter((e) => e.clock.phase === 'open').length;

  return (
    <Modal open={open} onClose={onClose} title="World Markets" maxWidth="max-w-2xl">
      {/* Summary */}
      <div className="mb-4 flex items-center gap-2 text-2xs text-text-muted">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
        <span>
          {openCount} of {MARKETS.length} markets open
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {entries.map(({ market, clock, progress }, i) => {
          const s = PHASE_STYLES[clock.phase];
          const isActive = clock.phase !== 'closed';
          const pct = Math.round(progress * 100);

          return (
            <div
              key={market.exchange}
              className={cn(
                'flex flex-col gap-3 rounded-xl border border-border bg-bg-primary p-4 transition-all duration-500',
                !isActive && 'opacity-65',
              )}
              style={{
                borderLeftWidth: 3,
                borderLeftColor: s.accent,
                boxShadow: s.glow,
                animation: 'waterfall-in 0.3s ease-out both',
                animationDelay: `${i * 50}ms`,
              }}
            >
              {/* ── Header: city + status ── */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg leading-none">{market.flag}</span>
                  <div>
                    <span className="text-sm font-medium text-text-primary">{market.city}</span>
                    <span className="ml-1.5 text-2xs text-text-muted">{market.exchange}</span>
                  </div>
                </div>
                <span
                  className={cn('flex items-center gap-1.5 rounded-full px-2 py-0.5 text-3xs font-medium', s.badge)}
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
                  {s.label}
                </span>
              </div>

              {/* ── Time + countdown ── */}
              <div className="flex items-end justify-between gap-2">
                <div>
                  <div className="font-headline text-2xl tabular-nums text-text-primary leading-tight">
                    {clock.time}
                  </div>
                  <div className="text-2xs text-text-muted mt-0.5">{clock.date}</div>
                </div>
                <div className={cn('text-right text-xs font-medium leading-tight whitespace-nowrap', s.countdown)}>
                  {clock.countdown}
                </div>
              </div>

              {/* ── Trading session bar ── */}
              <div className="flex flex-col gap-1.5">
                <div className="relative">
                  {/* Track */}
                  <div className="h-2 w-full overflow-hidden rounded-full bg-bg-tertiary">
                    <div
                      className={cn('h-full rounded-full transition-all duration-1000', s.bar)}
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  {/* Glowing marker dot for open markets */}
                  {clock.phase === 'open' && progress > 0.02 && progress < 0.98 && (
                    <div
                      className="absolute h-3.5 w-3.5 rounded-full border-2 border-bg-primary bg-success"
                      style={{
                        left: `${pct}%`,
                        top: '50%',
                        transform: 'translate(-50%, -50%)',
                        boxShadow: '0 0 8px rgba(91,185,140,0.5)',
                      }}
                    />
                  )}
                </div>
                <div className="flex justify-between text-3xs text-text-muted">
                  <span>{formatHour(market.hours[0])}</span>
                  <span>{formatHour(market.hours[1])}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
