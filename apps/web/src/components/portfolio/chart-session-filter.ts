export interface SessionFilterOptions {
  extendedHours: boolean;
}

const REGULAR_START_MIN = 9 * 60 + 30; // 09:30 ET
const REGULAR_END_MIN = 16 * 60; // 16:00 ET
const EXTENDED_START_MIN = 4 * 60; // 04:00 ET
const EXTENDED_END_MIN = 20 * 60; // 20:00 ET

function parseUTC(dateStr: string): Date {
  if (dateStr.includes('Z') || /[+-]\d{2}:?\d{2}$/.test(dateStr)) return new Date(dateStr);
  return new Date(dateStr.replace(' ', 'T') + 'Z');
}

function etMinuteOfDay(dateStr: string): number {
  const d = parseUTC(dateStr);
  const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return et.getHours() * 60 + et.getMinutes();
}

/**
 * Keep equity intraday candles inside the chosen session window.
 *
 * - Regular: 09:30–15:59 ET (TradingView default)
 * - Extended: 04:00–19:59 ET (pre- and after-hours included)
 *
 * Applies to every trading day in the input — no "latest day only" clamping.
 * Caller is responsible for skipping crypto + non-intraday candles.
 */
export function filterEquitySessionCandles<T extends { date: string }>(
  candles: T[],
  { extendedHours }: SessionFilterOptions,
): T[] {
  const start = extendedHours ? EXTENDED_START_MIN : REGULAR_START_MIN;
  const end = extendedHours ? EXTENDED_END_MIN : REGULAR_END_MIN;
  return candles.filter((c) => {
    const m = etMinuteOfDay(c.date);
    return m >= start && m < end;
  });
}
