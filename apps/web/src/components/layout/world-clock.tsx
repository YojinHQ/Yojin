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
}

const MARKETS: Market[] = [
  { city: 'New York', exchange: 'NYSE', timezone: 'America/New_York', hours: [570, 960], flag: '🇺🇸' },
  { city: 'London', exchange: 'LSE', timezone: 'Europe/London', hours: [480, 990], flag: '🇬🇧' },
  { city: 'Frankfurt', exchange: 'XETRA', timezone: 'Europe/Berlin', hours: [540, 1050], flag: '🇩🇪' },
  { city: 'Tokyo', exchange: 'TSE', timezone: 'Asia/Tokyo', hours: [540, 900], flag: '🇯🇵' },
  { city: 'Hong Kong', exchange: 'HKEX', timezone: 'Asia/Hong_Kong', hours: [570, 960], flag: '🇭🇰' },
  { city: 'Sydney', exchange: 'ASX', timezone: 'Australia/Sydney', hours: [600, 960], flag: '🇦🇺' },
];

type Status = 'open' | 'closed';

interface ClockData {
  time: string;
  date: string;
  status: Status;
  minutesInDay: number;
}

function getClockData(timezone: string, hours: [number, number]): ClockData {
  const now = new Date();

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
  const isOpen = !isWeekend && minutesInDay >= hours[0] && minutesInDay < hours[1];

  return {
    time: timeFmt.format(now),
    date: dateFmt.format(now),
    status: isOpen ? 'open' : 'closed',
    minutesInDay,
  };
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

  // Suppress unused-var lint — tick drives re-render
  void tick;

  return (
    <Modal open={open} onClose={onClose} title="World Markets" maxWidth="max-w-2xl">
      <div className="grid grid-cols-2 gap-3">
        {MARKETS.map((market) => {
          const clock = getClockData(market.timezone, market.hours);
          const progress = tradingProgress(clock.minutesInDay, market.hours);

          return (
            <div
              key={market.exchange}
              className="flex flex-col gap-3 rounded-xl border border-border bg-bg-primary p-4"
            >
              {/* City + status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-base">{market.flag}</span>
                  <div>
                    <div className="text-sm font-medium text-text-primary">{market.city}</div>
                    <div className="text-2xs text-text-muted">{market.exchange}</div>
                  </div>
                </div>
                <span
                  className={cn(
                    'flex items-center gap-1.5 rounded-full px-2 py-0.5 text-3xs font-medium',
                    clock.status === 'open' ? 'bg-success/15 text-success' : 'bg-text-muted/10 text-text-muted',
                  )}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      clock.status === 'open' ? 'bg-success animate-pulse' : 'bg-text-muted',
                    )}
                  />
                  {clock.status === 'open' ? 'Open' : 'Closed'}
                </span>
              </div>

              {/* Time */}
              <div>
                <div className="font-headline text-2xl tabular-nums text-text-primary">{clock.time}</div>
                <div className="text-2xs text-text-muted">{clock.date}</div>
              </div>

              {/* Trading session bar */}
              <div className="flex flex-col gap-1">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-tertiary">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-1000',
                      clock.status === 'open' ? 'bg-success' : 'bg-text-muted/30',
                    )}
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
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
