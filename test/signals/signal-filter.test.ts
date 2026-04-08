import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { filterStaleEnrichmentSignals } from '../../src/signals/signal-filter.js';
import type { Signal } from '../../src/signals/types.js';

/** Build a minimal signal for testing. */
function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: 'sig-1',
    contentHash: 'hash-1',
    type: 'TECHNICAL',
    title: 'Test Signal',
    assets: [{ ticker: 'AAPL', relevance: 0.9, linkType: 'DIRECT' }],
    sources: [{ id: 'jintel-key-event', name: 'Jintel Market Events', type: 'ENRICHMENT', reliability: 0.95 }],
    publishedAt: '2026-04-08T00:00:00.000Z',
    ingestedAt: '2026-04-08T00:00:00.000Z',
    confidence: 0.9,
    ...overrides,
  } as Signal;
}

describe('filterStaleEnrichmentSignals', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-08T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('filters key-event signals with dates older than 30 days in titles', () => {
    const stale = makeSignal({
      title: 'ETH: SIGNIFICANT MOVE on 2025-11-06',
    });

    const result = filterStaleEnrichmentSignals([stale]);
    expect(result).toHaveLength(0);
  });

  it('filters stale short-interest stragglers', () => {
    const staleShort = makeSignal({
      title: 'AAPL Short Interest 2025-10-01',
      sources: [{ id: 'jintel-short-interest', name: 'Jintel Short Interest', type: 'ENRICHMENT', reliability: 0.9 }],
    });

    const result = filterStaleEnrichmentSignals([staleShort]);
    expect(result).toHaveLength(0);
  });

  it('keeps key-event signals with recent dates in titles', () => {
    const fresh = makeSignal({
      title: 'AAPL: FIFTY TWO WEEK HIGH on 2026-04-05',
    });

    const result = filterStaleEnrichmentSignals([fresh]);
    expect(result).toHaveLength(1);
  });

  it('keeps signals without dates in titles', () => {
    const noDate = makeSignal({
      title: 'AAPL Market Snapshot',
    });

    const result = filterStaleEnrichmentSignals([noDate]);
    expect(result).toHaveLength(1);
  });

  it('keeps SEC filings with old dates (legitimate historical enrichment)', () => {
    const oldFiling = makeSignal({
      title: 'AAPL: 10-K filed 2025-12-15',
      sources: [{ id: 'jintel-sec', name: 'Jintel SEC', type: 'ENRICHMENT', reliability: 0.95 }],
    });

    const result = filterStaleEnrichmentSignals([oldFiling]);
    expect(result).toHaveLength(1);
  });

  it('keeps non-enrichment signals with old dates in titles', () => {
    const newsWithDate = makeSignal({
      title: 'Apple earnings report from 2025-11-06 still relevant',
      sources: [{ id: 'reuters', name: 'Reuters', type: 'API', reliability: 0.8 }],
    });

    const result = filterStaleEnrichmentSignals([newsWithDate]);
    expect(result).toHaveLength(1);
  });

  it('handles mixed batch correctly', () => {
    const signals = [
      makeSignal({ id: 'stale-event', title: 'ETH: VOLUME SPIKE on 2025-08-19' }),
      makeSignal({ id: 'fresh-event', title: 'AAPL: GAP MOVE on 2026-04-02' }),
      makeSignal({ id: 'no-date', title: 'BTC Short Interest' }),
      makeSignal({
        id: 'old-filing',
        title: 'AAPL: 10-K filed 2025-12-15',
        sources: [{ id: 'jintel-sec', name: 'Jintel SEC', type: 'ENRICHMENT', reliability: 0.95 }],
      }),
      makeSignal({
        id: 'news-old',
        title: 'Market crash on 2025-06-01',
        sources: [{ id: 'cnn', name: 'CNN', type: 'API', reliability: 0.7 }],
      }),
    ];

    const result = filterStaleEnrichmentSignals(signals);
    const ids = result.map((s) => s.id);
    expect(ids).toEqual(['fresh-event', 'no-date', 'old-filing', 'news-old']);
  });
});
