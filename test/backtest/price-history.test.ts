import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PriceHistoryProvider, pickJintelRange, shiftDays } from '../../src/backtest/price-history.js';
import type { PriceBar } from '../../src/backtest/types.js';

interface MockClient {
  priceHistory(
    tickers: string[],
    range: string,
    interval: string,
  ): Promise<
    | {
        success: true;
        data: {
          ticker: string;
          history: { date: string; open: number; high: number; low: number; close: number; volume: number }[];
        }[];
      }
    | { success: false; error: string }
  >;
}

function makeMockClient(bars: Record<string, PriceBar[]>): MockClient {
  return {
    async priceHistory(tickers: string[]) {
      return {
        success: true as const,
        data: tickers.map((t) => ({
          ticker: t,
          history: (bars[t] ?? []).map((b) => ({ ...b })),
        })),
      };
    },
  };
}

describe('pickJintelRange', () => {
  it('returns 1m for ≤31 day lookback', () => {
    const today = new Date('2026-04-01T00:00:00Z');
    expect(pickJintelRange('2026-03-15', today)).toBe('1m');
  });

  it('returns 1y for ~6-12 month lookback', () => {
    const today = new Date('2026-04-01T00:00:00Z');
    expect(pickJintelRange('2025-06-01', today)).toBe('1y');
  });

  it('returns 5d for very recent dates', () => {
    const today = new Date('2026-04-01T00:00:00Z');
    expect(pickJintelRange('2026-03-30', today)).toBe('5d');
  });
});

describe('shiftDays', () => {
  it('shifts forward', () => {
    expect(shiftDays('2026-01-01', 10)).toBe('2026-01-11');
  });
  it('shifts backward', () => {
    expect(shiftDays('2026-01-15', -10)).toBe('2026-01-05');
  });
  it('crosses month boundary', () => {
    expect(shiftDays('2026-01-30', 5)).toBe('2026-02-04');
  });
});

describe('PriceHistoryProvider', () => {
  it('returns empty array when no client and no cache', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ph-test-'));
    try {
      const ph = new PriceHistoryProvider({ client: null, cacheDir: dir });
      const bars = await ph.getBars('AAPL', '2026-01-01', '2026-01-10');
      expect(bars).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('fetches from client and writes JSONL cache', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ph-test-'));
    try {
      const bars: PriceBar[] = [
        { date: '2026-01-01', open: 100, high: 101, low: 99, close: 100.5, volume: 1000 },
        { date: '2026-01-02', open: 100.5, high: 102, low: 100, close: 101, volume: 1100 },
      ];
      const client = makeMockClient({ AAPL: bars });
      const ph = new PriceHistoryProvider({
        client: client as unknown as ConstructorParameters<typeof PriceHistoryProvider>[0]['client'],
        cacheDir: dir,
      });
      const fetched = await ph.getBars('AAPL', '2026-01-01', '2026-01-02');
      expect(fetched).toHaveLength(2);
      const cached = await readFile(join(dir, 'AAPL.jsonl'), 'utf-8');
      expect(cached.split('\n').filter(Boolean)).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('closeAt walks backwards past weekends/holidays', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ph-test-'));
    try {
      const bars: PriceBar[] = [
        { date: '2026-01-02', open: 100, high: 101, low: 99, close: 100, volume: 1000 },
        { date: '2026-01-05', open: 101, high: 102, low: 100, close: 101.5, volume: 1000 }, // Mon after weekend
      ];
      const client = makeMockClient({ AAPL: bars });
      const ph = new PriceHistoryProvider({
        client: client as unknown as ConstructorParameters<typeof PriceHistoryProvider>[0]['client'],
        cacheDir: dir,
      });
      // Ask for Sunday 2026-01-04 → should return Friday's close
      const close = await ph.closeAt('AAPL', '2026-01-04');
      expect(close).toBe(100);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('pctChange computes return from lookback to target date', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ph-test-'));
    try {
      const bars: PriceBar[] = [
        { date: '2026-01-01', open: 100, high: 100, low: 100, close: 100, volume: 0 },
        { date: '2026-01-11', open: 110, high: 110, low: 110, close: 110, volume: 0 },
      ];
      const client = makeMockClient({ AAPL: bars });
      const ph = new PriceHistoryProvider({
        client: client as unknown as ConstructorParameters<typeof PriceHistoryProvider>[0]['client'],
        cacheDir: dir,
      });
      const change = await ph.pctChange('AAPL', '2026-01-11', 10);
      expect(change).toBeCloseTo(10, 5);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('merges fresh fetches with existing cache', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ph-test-'));
    try {
      const client = makeMockClient({
        AAPL: [{ date: '2026-01-05', open: 105, high: 105, low: 105, close: 105, volume: 0 }],
      });
      const ph = new PriceHistoryProvider({
        client: client as unknown as ConstructorParameters<typeof PriceHistoryProvider>[0]['client'],
        cacheDir: dir,
      });
      // First fetch writes the bar to cache
      await ph.getBars('AAPL', '2026-01-05', '2026-01-05');

      // Second fetch with different range triggers merge
      const client2 = makeMockClient({
        AAPL: [{ date: '2026-01-10', open: 110, high: 110, low: 110, close: 110, volume: 0 }],
      });
      const ph2 = new PriceHistoryProvider({
        client: client2 as unknown as ConstructorParameters<typeof PriceHistoryProvider>[0]['client'],
        cacheDir: dir,
      });
      await ph2.getBars('AAPL', '2026-01-05', '2026-01-10');

      const cached = await readFile(join(dir, 'AAPL.jsonl'), 'utf-8');
      const lines = cached.split('\n').filter(Boolean);
      expect(lines.length).toBeGreaterThanOrEqual(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
