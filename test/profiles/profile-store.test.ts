import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TickerProfileStore } from '../../src/profiles/profile-store.js';
import type { TickerProfileEntry } from '../../src/profiles/types.js';

function makeEntry(
  overrides: Partial<Omit<TickerProfileEntry, 'id' | 'createdAt'>> = {},
): Omit<TickerProfileEntry, 'id' | 'createdAt'> {
  return {
    ticker: 'AAPL',
    category: 'PATTERN',
    observation: 'RSI oversold preceded a 3% bounce',
    evidence: 'RSI dropped to 28, price recovered within 3 days',
    insightReportId: 'report-001',
    insightDate: '2026-03-20T00:00:00.000Z',
    rating: 'BULLISH',
    conviction: 0.8,
    priceAtObservation: 175.5,
    grade: null,
    actualReturn: null,
    ...overrides,
  };
}

describe('TickerProfileStore', () => {
  let dir: string;
  let store: TickerProfileStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'profiles-'));
    store = new TickerProfileStore({ dataDir: dir });
    await store.initialize();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('store', () => {
    it('creates an entry and returns an id', async () => {
      const id = await store.store(makeEntry());
      expect(id).toBeTruthy();
      expect(id.length).toBeGreaterThan(0);
    });

    it('persists entry to JSONL file', async () => {
      await store.store(makeEntry());

      const content = await readFile(join(dir, 'AAPL.jsonl'), 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(1);

      const entry = JSON.parse(lines[0]) as TickerProfileEntry;
      expect(entry.ticker).toBe('AAPL');
      expect(entry.category).toBe('PATTERN');
      expect(entry.observation).toContain('RSI oversold');
    });

    it('stores entries for different tickers in separate files', async () => {
      await store.store(makeEntry({ ticker: 'AAPL' }));
      await store.store(makeEntry({ ticker: 'MSFT' }));

      const aaplContent = await readFile(join(dir, 'AAPL.jsonl'), 'utf-8');
      const msftContent = await readFile(join(dir, 'MSFT.jsonl'), 'utf-8');
      expect(aaplContent.trim().split('\n')).toHaveLength(1);
      expect(msftContent.trim().split('\n')).toHaveLength(1);
    });
  });

  describe('storeBatch', () => {
    it('stores multiple entries and returns count', async () => {
      const count = await store.storeBatch([
        makeEntry({ ticker: 'AAPL', observation: 'Pattern 1' }),
        makeEntry({ ticker: 'AAPL', observation: 'Pattern 2' }),
        makeEntry({ ticker: 'MSFT', observation: 'Pattern 3' }),
      ]);

      expect(count).toBe(3);
      expect(store.getForTicker('AAPL')).toHaveLength(2);
      expect(store.getForTicker('MSFT')).toHaveLength(1);
    });
  });

  describe('getForTicker', () => {
    it('returns empty array for unknown ticker', () => {
      expect(store.getForTicker('UNKNOWN')).toEqual([]);
    });

    it('returns all entries for a ticker', async () => {
      await store.store(makeEntry({ observation: 'Pattern 1' }));
      await store.store(makeEntry({ observation: 'Pattern 2' }));

      const entries = store.getForTicker('AAPL');
      expect(entries).toHaveLength(2);
    });
  });

  describe('getRecent', () => {
    it('returns last N entries', async () => {
      for (let i = 0; i < 5; i++) {
        await store.store(makeEntry({ observation: `Pattern ${i}` }));
      }

      const recent = store.getRecent('AAPL', 3);
      expect(recent).toHaveLength(3);
      expect(recent[0].observation).toBe('Pattern 2');
      expect(recent[2].observation).toBe('Pattern 4');
    });
  });

  describe('search', () => {
    it('returns empty array for unknown ticker', () => {
      expect(store.search('UNKNOWN', 'RSI')).toEqual([]);
    });

    it('finds entries by text similarity', async () => {
      await store.store(makeEntry({ observation: 'RSI oversold preceded bounce', evidence: 'RSI at 28' }));
      await store.store(
        makeEntry({ observation: 'MACD crossover bullish signal', evidence: 'MACD crossed above signal line' }),
      );
      await store.store(makeEntry({ observation: 'Earnings beat expectations', evidence: 'EPS beat by 15%' }));

      const results = store.search('AAPL', 'RSI oversold');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entry.observation).toContain('RSI');
    });
  });

  describe('buildBrief', () => {
    it('returns empty brief for unknown ticker', () => {
      const brief = store.buildBrief('UNKNOWN');
      expect(brief.entryCount).toBe(0);
      expect(brief.recentPatterns).toEqual([]);
    });

    it('builds brief with patterns and sentiment history', async () => {
      await store.store(makeEntry({ category: 'PATTERN', observation: 'RSI oversold bounce' }));
      await store.store(makeEntry({ category: 'PATTERN', observation: 'Earnings beat drove 5% move' }));
      await store.store(
        makeEntry({
          category: 'LESSON',
          observation: 'Overweighted sentiment shift',
          grade: 'INCORRECT',
          actualReturn: -2.5,
        }),
      );
      await store.store(
        makeEntry({
          category: 'CORRELATION',
          observation: 'Correlated with NVDA via AI supply chain',
        }),
      );
      await store.store(
        makeEntry({
          category: 'SENTIMENT_SHIFT',
          observation: 'Shifted from BULLISH to BEARISH',
          rating: 'BEARISH',
          conviction: 0.6,
        }),
      );

      const brief = store.buildBrief('AAPL');
      expect(brief.entryCount).toBe(5);
      expect(brief.recentPatterns.length).toBeGreaterThan(0);
      expect(brief.recentLessons).toHaveLength(1);
      expect(brief.correlations).toHaveLength(1);
      expect(brief.sentimentHistory.length).toBeGreaterThan(0);
    });

    it('deduplicates similar patterns', async () => {
      for (let i = 0; i < 5; i++) {
        await store.store(makeEntry({ category: 'PATTERN', observation: 'RSI oversold preceded bounce' }));
      }

      const brief = store.buildBrief('AAPL');
      expect(brief.recentPatterns).toHaveLength(1);
      expect(brief.recentPatterns[0]).toContain('(5x)');
    });
  });

  describe('prune', () => {
    it('does nothing when under limit', async () => {
      await store.store(makeEntry());
      const removed = await store.prune('AAPL');
      expect(removed).toBe(0);
    });

    it('removes excess entries, prioritizing LESSON retention', async () => {
      const smallStore = new TickerProfileStore({ dataDir: dir, maxEntriesPerTicker: 3 });
      await smallStore.initialize();

      // Store 5 entries: 2 CONTEXT (lowest priority), 1 LESSON (highest), 2 PATTERN
      await smallStore.store(makeEntry({ category: 'CONTEXT', observation: 'Context 1' }));
      await smallStore.store(makeEntry({ category: 'CONTEXT', observation: 'Context 2' }));
      await smallStore.store(
        makeEntry({
          category: 'LESSON',
          observation: 'Important lesson',
          grade: 'CORRECT',
          actualReturn: 5.0,
        }),
      );
      await smallStore.store(makeEntry({ category: 'PATTERN', observation: 'Pattern 1' }));
      await smallStore.store(makeEntry({ category: 'PATTERN', observation: 'Pattern 2' }));

      const removed = await smallStore.prune('AAPL');
      expect(removed).toBe(2);

      const remaining = smallStore.getForTicker('AAPL');
      expect(remaining).toHaveLength(3);
      // LESSON should be retained
      expect(remaining.some((e) => e.category === 'LESSON')).toBe(true);
    });
  });

  describe('persistence', () => {
    it('reloads entries from disk on initialize', async () => {
      await store.store(makeEntry({ ticker: 'AAPL', observation: 'Persisted pattern' }));
      await store.store(makeEntry({ ticker: 'MSFT', observation: 'MSFT pattern' }));

      // Create a new store pointing to the same directory
      const store2 = new TickerProfileStore({ dataDir: dir });
      await store2.initialize();

      expect(store2.getForTicker('AAPL')).toHaveLength(1);
      expect(store2.getForTicker('AAPL')[0].observation).toBe('Persisted pattern');
      expect(store2.getForTicker('MSFT')).toHaveLength(1);
    });
  });

  describe('getTickers', () => {
    it('returns all tickers with entries', async () => {
      await store.store(makeEntry({ ticker: 'AAPL' }));
      await store.store(makeEntry({ ticker: 'MSFT' }));
      await store.store(makeEntry({ ticker: 'BTC' }));

      const tickers = store.getTickers();
      expect(tickers).toHaveLength(3);
      expect(tickers).toContain('AAPL');
      expect(tickers).toContain('MSFT');
      expect(tickers).toContain('BTC');
    });
  });
});
