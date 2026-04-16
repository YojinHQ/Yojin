import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MarketSentimentBaselineStore } from '../../src/market-sentiment/baseline-store.js';
import type { SentimentSnapshot } from '../../src/market-sentiment/types.js';

function makeSnapshot(ticker: string, date: string, mentions: number, mentions24hAgo: number): SentimentSnapshot {
  return {
    ticker,
    date,
    timestamp: `${date}T12:00:00.000Z`,
    rank: 5,
    mentions,
    mentions24hAgo,
    upvotes: 42,
    mentionMomentum: mentions24hAgo > 0 ? (mentions - mentions24hAgo) / mentions24hAgo : null,
  };
}

describe('MarketSentimentBaselineStore', () => {
  let dir: string;
  let store: MarketSentimentBaselineStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'market-sentiment-'));
    // Create the subdirectory the store expects
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(dir, 'market-sentiment'), { recursive: true });
    store = new MarketSentimentBaselineStore(dir);
    store.initialize();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  it('appends and retrieves snapshots', () => {
    expect(store.append(makeSnapshot('SPY', '2026-04-01', 120, 100))).toBe(true);
    expect(store.append(makeSnapshot('SPY', '2026-04-02', 130, 110))).toBe(true);
    expect(store.size).toBe(2);

    const spyData = store.getForTicker('SPY');
    expect(spyData).toHaveLength(2);
    expect(spyData[0].date).toBe('2026-04-01');
    expect(spyData[1].date).toBe('2026-04-02');
  });

  it('dedupes by ticker+date', () => {
    expect(store.append(makeSnapshot('SPY', '2026-04-01', 120, 100))).toBe(true);
    expect(store.append(makeSnapshot('SPY', '2026-04-01', 999, 888))).toBe(false);
    expect(store.size).toBe(1);
    // First value is kept
    expect(store.getForTicker('SPY')[0].mentions).toBe(120);
  });

  it('persists to disk and survives re-initialization', () => {
    store.append(makeSnapshot('SPY', '2026-04-01', 120, 100));
    store.append(makeSnapshot('QQQ', '2026-04-01', 80, 60));

    // Create a new store pointing at the same directory
    const store2 = new MarketSentimentBaselineStore(dir);
    store2.initialize();
    expect(store2.size).toBe(2);
    expect(store2.getForTicker('SPY')).toHaveLength(1);
    expect(store2.getForTicker('QQQ')).toHaveLength(1);
  });

  it('computes stats when enough data exists', () => {
    // Add 14 days of data for SPY (MIN_BASELINE_DAYS = 14)
    for (let i = 1; i <= 14; i++) {
      const day = String(i).padStart(2, '0');
      store.append(makeSnapshot('SPY', `2026-04-${day}`, 100 + i * 5, 100));
    }

    expect(store.hasEnoughData('SPY')).toBe(true);
    const stats = store.computeStats('SPY');
    expect(stats).not.toBeNull();
    expect(stats!.ticker).toBe('SPY');
    expect(stats!.dataPoints).toBe(14);
    expect(stats!.mentionsMean).toBeGreaterThan(100);
    expect(stats!.mentionsStdDev).toBeGreaterThan(0);
  });

  it('returns null stats when insufficient data', () => {
    store.append(makeSnapshot('SPY', '2026-04-01', 120, 100));
    expect(store.hasEnoughData('SPY')).toBe(false);
    expect(store.computeStats('SPY')).toBeNull();
  });

  it('getRange filters by date bounds', () => {
    store.append(makeSnapshot('SPY', '2026-04-01', 120, 100));
    store.append(makeSnapshot('SPY', '2026-04-05', 130, 110));
    store.append(makeSnapshot('SPY', '2026-04-10', 140, 120));

    const range = store.getRange('2026-04-03', '2026-04-08');
    expect(range).toHaveLength(1);
    expect(range[0].date).toBe('2026-04-05');
  });
});
