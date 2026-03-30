import { useState, useEffect } from 'react';
import Modal from '../common/modal';
import { cn } from '../../lib/utils';

/* ── Types ───────────────────────────────────── */

interface Market {
  city: string;
  exchange: string;
  timezone: string;
  hours: [number, number];
  flag: string;
  color: string;
  preMarketHours?: [number, number];
  afterHoursRange?: [number, number];
}

type Phase = 'pre-market' | 'open' | 'after-hours' | 'closed';

interface ClockData {
  time: string;
  phase: Phase;
  minutesInDay: number;
  countdown: string;
}

/* ── Markets ─────────────────────────────────── */

const MARKETS: Market[] = [
  {
    city: 'New York',
    exchange: 'NYSE',
    timezone: 'America/New_York',
    hours: [570, 960],
    flag: '\u{1F1FA}\u{1F1F8}',
    color: '#F6B93B',
    preMarketHours: [240, 570],
    afterHoursRange: [960, 1200],
  },
  {
    city: 'London',
    exchange: 'LSE',
    timezone: 'Europe/London',
    hours: [480, 990],
    flag: '\u{1F1EC}\u{1F1E7}',
    color: '#38BDF8',
  },
  {
    city: 'Frankfurt',
    exchange: 'XETRA',
    timezone: 'Europe/Berlin',
    hours: [540, 1050],
    flag: '\u{1F1E9}\u{1F1EA}',
    color: '#A78BFA',
  },
  {
    city: 'Tokyo',
    exchange: 'TSE',
    timezone: 'Asia/Tokyo',
    hours: [540, 900],
    flag: '\u{1F1EF}\u{1F1F5}',
    color: '#FB7185',
  },
  {
    city: 'Hong Kong',
    exchange: 'HKEX',
    timezone: 'Asia/Hong_Kong',
    hours: [570, 960],
    flag: '\u{1F1ED}\u{1F1F0}',
    color: '#FB923C',
  },
  {
    city: 'Sydney',
    exchange: 'ASX',
    timezone: 'Australia/Sydney',
    hours: [600, 960],
    flag: '\u{1F1E6}\u{1F1FA}',
    color: '#34D399',
  },
];

/* ── SVG Layout ──────────────────────────────── */

const SVG = 300;
const C = SVG / 2;
const ARC_W = 8;
const ARC_GAP = 5;
const R_OUTER = 130;
const RADII = MARKETS.map((_, i) => R_OUTER - i * (ARC_W + ARC_GAP));
const TICK_R = R_OUTER + ARC_GAP + 4;

/* ── Time Helpers ────────────────────────────── */

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

  const parts = timeFmt.formatToParts(now).reduce<Record<string, string>>((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});

  const day = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(now);
  const h = parseInt(parts.hour, 10);
  const m = parseInt(parts.minute, 10);
  const minutesInDay = h * 60 + m;
  const isWeekend = day === 'Sat' || day === 'Sun';

  let phase: Phase = 'closed';
  if (!isWeekend) {
    if (minutesInDay >= hours[0] && minutesInDay < hours[1]) phase = 'open';
    else if (preMarketHours && minutesInDay >= preMarketHours[0] && minutesInDay < preMarketHours[1])
      phase = 'pre-market';
    else if (afterHoursRange && minutesInDay >= afterHoursRange[0] && minutesInDay < afterHoursRange[1])
      phase = 'after-hours';
  }

  return {
    time: timeFmt.format(now),
    phase,
    minutesInDay,
    countdown: fmtCountdown(minutesInDay, hours, phase, isWeekend),
  };
}

function fmtCountdown(min: number, hours: [number, number], phase: Phase, weekend: boolean): string {
  if (weekend) return 'Opens Mon';
  if (phase === 'open') return fmtDur(hours[1] - min, 'Closes');
  if (phase === 'pre-market' || min < hours[0]) return fmtDur(hours[0] - min, 'Opens');
  if (phase === 'after-hours') return `Opens tmrw ${fmtHr(hours[0])}`;
  return `Opens ${fmtHr(hours[0])}`;
}

function fmtDur(totalMin: number, pfx: string): string {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${pfx} in ${h}h ${m}m` : `${pfx} in ${m}m`;
}

function fmtHr(min: number): string {
  return `${Math.floor(min / 60)
    .toString()
    .padStart(2, '0')}:${(min % 60).toString().padStart(2, '0')}`;
}

/* ── UTC / Arc Geometry ──────────────────────── */

function utcOffset(tz: string): number {
  const now = new Date();
  const ps = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);
  const lH = parseInt(ps.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const lM = parseInt(ps.find((p) => p.type === 'minute')?.value ?? '0', 10);
  let off = lH * 60 + lM - (now.getUTCHours() * 60 + now.getUTCMinutes());
  if (off > 720) off -= 1440;
  if (off < -720) off += 1440;
  return off;
}

function toUtcMin(localMin: number, off: number): number {
  return (((localMin - off) % 1440) + 1440) % 1440;
}

function minToAngle(min: number): number {
  return (min / 1440) * 360;
}

function arcPath(cx: number, cy: number, r: number, a1: number, a2: number): string {
  const rad = (d: number) => ((d - 90) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(rad(a1));
  const y1 = cy + r * Math.sin(rad(a1));
  const x2 = cx + r * Math.cos(rad(a2));
  const y2 = cy + r * Math.sin(rad(a2));
  let span = a2 - a1;
  if (span < 0) span += 360;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${span > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

function getArcLen(spanDeg: number, r: number): number {
  let s = spanDeg;
  if (s < 0) s += 360;
  return (s / 360) * 2 * Math.PI * r;
}

/* ── Phase Styles ────────────────────────────── */

const PH: Record<Phase, { label: string; dot: string; text: string }> = {
  open: { label: 'Open', dot: 'bg-success animate-pulse', text: 'text-success' },
  'pre-market': { label: 'Pre-Mkt', dot: 'bg-warning animate-pulse', text: 'text-warning' },
  'after-hours': { label: 'After Hrs', dot: 'bg-market animate-pulse', text: 'text-market' },
  closed: { label: 'Closed', dot: 'bg-text-muted/40', text: 'text-text-muted' },
};

/* ── Component ───────────────────────────────── */

interface WorldClockProps {
  open: boolean;
  onClose: () => void;
}

export default function WorldClock({ open, onClose }: WorldClockProps) {
  const [tick, setTick] = useState(0);
  const [arcsReady, setArcsReady] = useState(false);

  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setTick((t) => t + 1), 1_000);
    requestAnimationFrame(() => setArcsReady(true));
    return () => {
      clearInterval(id);
      setArcsReady(false);
    };
  }, [open]);

  void tick;

  const now = new Date();
  const utcFrac = now.getUTCHours() * 60 + now.getUTCMinutes() + now.getUTCSeconds() / 60;
  const nowAngle = (utcFrac / 1440) * 360;

  const utcStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);

  const entries = MARKETS.map((market, i) => {
    const clock = getClockData(market);
    const off = utcOffset(market.timezone);
    const uOpen = toUtcMin(market.hours[0], off);
    const uClose = toUtcMin(market.hours[1], off);
    const a1 = minToAngle(uOpen);
    const a2 = minToAngle(uClose);
    let span = a2 - a1;
    if (span < 0) span += 360;
    return { market, clock, a1, a2, span, r: RADII[i], len: getArcLen(span, RADII[i]) };
  });

  const openCount = entries.filter((e) => e.clock.phase === 'open').length;

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-2xl" aria-labelledby="wc-title">
      {/* ── Header ── */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 id="wc-title" className="font-headline text-xl text-text-primary">
            World Markets
          </h2>
          <p className="mt-1 flex items-center gap-2 text-2xs text-text-muted">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
            {openCount} of {MARKETS.length} exchanges trading
            <span className="opacity-30">&middot;</span>
            UTC {utcStr}
          </p>
        </div>
        <button onClick={onClose} className="cursor-pointer text-text-muted transition-colors hover:text-text-primary">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* ── 24-Hour Trading Dial ── */}
      <div className="flex justify-center mb-6">
        <svg
          viewBox="-10 -10 320 320"
          className="w-full max-w-[280px]"
          role="img"
          aria-label="24-hour trading session dial"
        >
          <defs>
            <pattern id="wc-dots" width="10" height="10" patternUnits="userSpaceOnUse">
              <circle cx="5" cy="5" r="0.4" fill="var(--color-text-muted)" opacity="0.12" />
            </pattern>
          </defs>

          {/* Dot-grid background */}
          <circle cx={C} cy={C} r={TICK_R + 2} fill="url(#wc-dots)" />

          {/* Outer rim */}
          <circle
            cx={C}
            cy={C}
            r={TICK_R + 1}
            fill="none"
            stroke="var(--color-border)"
            strokeWidth="0.5"
            opacity="0.3"
          />

          {/* Quadrant guides (subtle cross-hairs) */}
          {[0, 90, 180, 270].map((deg) => {
            const rad = ((deg - 90) * Math.PI) / 180;
            const inner = RADII[RADII.length - 1] - 8;
            return (
              <line
                key={deg}
                x1={C + inner * Math.cos(rad)}
                y1={C + inner * Math.sin(rad)}
                x2={C + TICK_R * Math.cos(rad)}
                y2={C + TICK_R * Math.sin(rad)}
                stroke="var(--color-border)"
                strokeWidth="0.5"
                opacity="0.15"
              />
            );
          })}

          {/* 24 hour ticks */}
          {Array.from({ length: 24 }, (_, i) => {
            const deg = (i / 24) * 360;
            const rad = ((deg - 90) * Math.PI) / 180;
            const major = i % 6 === 0;
            const tickLen = major ? 6 : 3;
            return (
              <line
                key={i}
                x1={C + (TICK_R - tickLen) * Math.cos(rad)}
                y1={C + (TICK_R - tickLen) * Math.sin(rad)}
                x2={C + TICK_R * Math.cos(rad)}
                y2={C + TICK_R * Math.sin(rad)}
                stroke="var(--color-text-muted)"
                strokeWidth={major ? 1.5 : 0.75}
                opacity={major ? 0.5 : 0.2}
                strokeLinecap="round"
              />
            );
          })}

          {/* Cardinal hour labels */}
          {[
            { label: '00', x: C, y: C - TICK_R - 6, anchor: 'middle' as const },
            { label: '06', x: C + TICK_R + 8, y: C + 3, anchor: 'start' as const },
            { label: '12', x: C, y: C + TICK_R + 12, anchor: 'middle' as const },
            { label: '18', x: C - TICK_R - 8, y: C + 3, anchor: 'end' as const },
          ].map(({ label, x, y, anchor }) => (
            <text
              key={label}
              x={x}
              y={y}
              textAnchor={anchor}
              fill="var(--color-text-muted)"
              fontSize="9"
              fontFamily="var(--font-body)"
              fontWeight="500"
              opacity="0.45"
            >
              {label}
            </text>
          ))}

          {/* Market session arcs */}
          {entries.map(({ market, clock, a1, a2, len, r }, i) => {
            const active = clock.phase !== 'closed';
            return (
              <path
                key={market.exchange}
                d={arcPath(C, C, r, a1, a2)}
                fill="none"
                stroke={market.color}
                strokeWidth={ARC_W}
                strokeLinecap="round"
                opacity={active ? 1 : 0.25}
                style={{
                  strokeDasharray: len,
                  strokeDashoffset: arcsReady ? 0 : len,
                  transition: `stroke-dashoffset 1s ease-out ${i * 80}ms, opacity 0.5s ease-out ${i * 80}ms`,
                  filter: active ? `drop-shadow(0 0 4px ${market.color}50)` : undefined,
                }}
              />
            );
          })}

          {/* "Now" hand */}
          {(() => {
            const rad = ((nowAngle - 90) * Math.PI) / 180;
            const tipR = TICK_R - 1;
            const tx = C + tipR * Math.cos(rad);
            const ty = C + tipR * Math.sin(rad);
            const bR = 12;
            const bx = C + bR * Math.cos(rad);
            const by = C + bR * Math.sin(rad);
            return (
              <g style={{ filter: 'drop-shadow(0 0 3px rgba(255,255,255,0.2))' }}>
                <line
                  x1={bx}
                  y1={by}
                  x2={tx}
                  y2={ty}
                  stroke="var(--color-text-primary)"
                  strokeWidth="1"
                  opacity="0.45"
                  strokeLinecap="round"
                />
                <circle
                  cx={tx}
                  cy={ty}
                  r="2.5"
                  fill="var(--color-text-primary)"
                  opacity="0.85"
                  className="animate-pulse"
                />
              </g>
            );
          })()}

          {/* Center pivot */}
          <circle cx={C} cy={C} r="4" fill="var(--color-text-muted)" opacity="0.12" />
          <circle cx={C} cy={C} r="1.5" fill="var(--color-text-muted)" opacity="0.35" />

          {/* UTC label */}
          <text
            x={C}
            y={C + 18}
            textAnchor="middle"
            fill="var(--color-text-muted)"
            fontSize="7"
            fontFamily="var(--font-body)"
            fontWeight="600"
            letterSpacing="2"
            opacity="0.25"
          >
            UTC
          </text>
        </svg>
      </div>

      {/* ── Market Grid ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {entries.map(({ market, clock }, i) => {
          const active = clock.phase !== 'closed';
          const ph = PH[clock.phase];
          return (
            <div
              key={market.exchange}
              className={cn(
                'flex flex-col gap-1 rounded-lg border border-border px-3 py-2.5 transition-all duration-300',
                active ? 'bg-bg-card/50' : 'bg-transparent opacity-45',
              )}
              style={{
                animation: 'waterfall-in 0.3s ease-out both',
                animationDelay: `${500 + i * 60}ms`,
              }}
            >
              {/* City + exchange */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm leading-none">{market.flag}</span>
                  <span className="text-xs font-medium text-text-primary">{market.city}</span>
                </div>
                <span className="text-3xs text-text-muted">{market.exchange}</span>
              </div>

              {/* Local time */}
              <div className="text-lg tabular-nums font-light text-text-primary tracking-tight leading-tight">
                {clock.time}
              </div>

              {/* Status + countdown */}
              <div className="flex items-center gap-1.5">
                <span className={cn('h-1 w-1 rounded-full', ph.dot)} />
                <span className={cn('text-3xs font-medium', ph.text)}>{ph.label}</span>
                <span className="ml-auto text-3xs text-text-muted/60 truncate">{clock.countdown}</span>
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
