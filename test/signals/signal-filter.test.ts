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

  it('filters enrichment signals with dates older than 30 days in titles', () => {
    const stale = makeSignal({
      title: 'ETH: SIGNIFICANT MOVE on 2025-11-06',
    });

    const result = filterStaleEnrichmentSignals([stale]);
    expect(result).toHaveLength(0);
  });

  it('keeps enrichment signals with recent dates in titles', () => {
    const fresh = makeSignal({
      title: 'AAPL: FIFTY TWO WEEK HIGH on 2026-04-05',
    });

    const result = filterStaleEnrichmentSignals([fresh]);
    expect(result).toHaveLength(1);
  });

  it('keeps enrichment signals without dates in titles', () => {
    const noDate = makeSignal({
      title: 'AAPL Market Snapshot',
    });

    const result = filterStaleEnrichmentSignals([noDate]);
    expect(result).toHaveLength(1);
  });

  it('keeps non-enrichment signals even with old dates in titles', () => {
    const newsWithDate = makeSignal({
      title: 'Apple earnings report from 2025-11-06 still relevant',
      sources: [{ id: 'reuters', name: 'Reuters', type: 'API', reliability: 0.8 }],
    });

    const result = filterStaleEnrichmentSignals([newsWithDate]);
    expect(result).toHaveLength(1);
  });

  it('handles mixed batch correctly', () => {
    const signals = [
      makeSignal({ id: 'stale', title: 'ETH: VOLUME SPIKE on 2025-08-19' }),
      makeSignal({ id: 'fresh', title: 'AAPL: GAP MOVE on 2026-04-02' }),
      makeSignal({ id: 'no-date', title: 'BTC Short Interest' }),
      makeSignal({
        id: 'news-old',
        title: 'Market crash on 2025-06-01',
        sources: [{ id: 'cnn', name: 'CNN', type: 'API', reliability: 0.7 }],
      }),
    ];

    const result = filterStaleEnrichmentSignals(signals);
    const ids = result.map((s) => s.id);
    expect(ids).toEqual(['fresh', 'no-date', 'news-old']);
  });
});
