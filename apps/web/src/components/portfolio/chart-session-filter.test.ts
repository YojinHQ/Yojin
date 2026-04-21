import { describe, it, expect } from 'vitest';
import { filterEquitySessionCandles } from './chart-session-filter';

interface Candle {
  date: string;
}

// Build ISO timestamp for a given ET date + hour/minute.
// ET is UTC-5 (EST) or UTC-4 (EDT). Use a known EDT date (April) — offset -04:00.
function et(isoDate: string, hour: number, minute: number): Candle {
  return {
    date: `${isoDate}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00-04:00`,
  };
}

describe('filterEquitySessionCandles', () => {
  it('returns empty array for empty input', () => {
    expect(filterEquitySessionCandles([], { extendedHours: false })).toEqual([]);
    expect(filterEquitySessionCandles([], { extendedHours: true })).toEqual([]);
  });

  describe('regular hours mode (extendedHours: false)', () => {
    it('keeps 09:30-15:59 ET candles', () => {
      const candles = [et('2026-04-15', 9, 30), et('2026-04-15', 12, 0), et('2026-04-15', 15, 59)];
      const out = filterEquitySessionCandles(candles, { extendedHours: false });
      expect(out).toHaveLength(3);
    });

    it('drops pre-market (before 09:30 ET)', () => {
      const candles = [et('2026-04-15', 4, 0), et('2026-04-15', 9, 29), et('2026-04-15', 9, 30)];
      const out = filterEquitySessionCandles(candles, { extendedHours: false });
      expect(out).toHaveLength(1);
      expect(out[0]).toEqual(et('2026-04-15', 9, 30));
    });

    it('drops after-hours (at or after 16:00 ET)', () => {
      const candles = [et('2026-04-15', 15, 45), et('2026-04-15', 16, 0), et('2026-04-15', 19, 0)];
      const out = filterEquitySessionCandles(candles, { extendedHours: false });
      expect(out).toHaveLength(1);
      expect(out[0]).toEqual(et('2026-04-15', 15, 45));
    });

    it('retains regular-hours candles across multiple days', () => {
      const candles = [
        et('2026-04-13', 10, 0),
        et('2026-04-13', 17, 0), // dropped
        et('2026-04-14', 8, 0), // dropped
        et('2026-04-14', 10, 0),
        et('2026-04-15', 15, 30),
      ];
      const out = filterEquitySessionCandles(candles, { extendedHours: false });
      expect(out).toHaveLength(3);
      expect(out.map((c) => c.date)).toEqual([
        et('2026-04-13', 10, 0).date,
        et('2026-04-14', 10, 0).date,
        et('2026-04-15', 15, 30).date,
      ]);
    });
  });

  describe('extended hours mode (extendedHours: true)', () => {
    it('keeps 04:00-19:59 ET candles', () => {
      const candles = [et('2026-04-15', 4, 0), et('2026-04-15', 12, 0), et('2026-04-15', 19, 59)];
      const out = filterEquitySessionCandles(candles, { extendedHours: true });
      expect(out).toHaveLength(3);
    });

    it('drops overnight (before 04:00 ET)', () => {
      const candles = [et('2026-04-15', 2, 0), et('2026-04-15', 3, 59), et('2026-04-15', 4, 0)];
      const out = filterEquitySessionCandles(candles, { extendedHours: true });
      expect(out).toHaveLength(1);
      expect(out[0]).toEqual(et('2026-04-15', 4, 0));
    });

    it('drops candles at or after 20:00 ET', () => {
      const candles = [et('2026-04-15', 19, 45), et('2026-04-15', 20, 0), et('2026-04-15', 22, 0)];
      const out = filterEquitySessionCandles(candles, { extendedHours: true });
      expect(out).toHaveLength(1);
      expect(out[0]).toEqual(et('2026-04-15', 19, 45));
    });
  });

  it('preserves input order', () => {
    const candles = [et('2026-04-15', 10, 0), et('2026-04-15', 11, 0), et('2026-04-15', 12, 0)];
    const out = filterEquitySessionCandles(candles, { extendedHours: false });
    expect(out).toEqual(candles);
  });

  it('filters correctly in EST (winter offset -05:00)', () => {
    // 2026-01-15 09:29 EST = 14:29 UTC (should be dropped — pre-open)
    const preOpen = { date: '2026-01-15T14:29:00Z' };
    // 2026-01-15 09:30 EST = 14:30 UTC (should be kept — market open)
    const open = { date: '2026-01-15T14:30:00Z' };
    const out = filterEquitySessionCandles([preOpen, open], { extendedHours: false });
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(open);
  });
});
