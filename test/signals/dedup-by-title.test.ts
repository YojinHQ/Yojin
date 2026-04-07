import { describe, expect, it } from 'vitest';

import { deduplicateByTitle } from '../../src/signals/signal-filter.js';
import type { Signal } from '../../src/signals/types.js';

function makeSignal(overrides: Partial<Signal> & { title: string; tickers?: string[] }): Signal {
  const { tickers = ['GOOGL'], ...rest } = overrides;
  return {
    id: `sig-${Math.random().toString(36).slice(2, 8)}`,
    contentHash: 'hash',
    type: 'NEWS',
    title: rest.title,
    assets: tickers.map((t) => ({ ticker: t, assetClass: 'STOCK' as const })),
    sources: [{ id: 'src-1', name: 'Test', type: 'NEWS_FEED' }],
    publishedAt: '2026-04-07T00:00:00Z',
    ingestedAt: '2026-04-07T01:00:00Z',
    confidence: 0.8,
    linkType: 'DIRECT',
    version: 1,
    ...rest,
  } as Signal;
}

describe('deduplicateByTitle', () => {
  it('deduplicates exact title matches', () => {
    const signals = [
      makeSignal({ title: 'GOOGL earnings beat expectations', confidence: 0.9 }),
      makeSignal({ title: 'GOOGL earnings beat expectations', confidence: 0.7 }),
    ];
    const result = deduplicateByTitle(signals);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(0.9);
  });

  it('deduplicates fuzzy title matches for same event', () => {
    const signals = [
      makeSignal({ title: 'Google, Broadcom sign five-year AI chip deal', tickers: ['GOOGL'] }),
      makeSignal({ title: 'Broadcom Signs Multi-Year AI Chip Deals With Google', tickers: ['GOOGL'] }),
      makeSignal({ title: 'Broadcom expands AI chip supply deal with Google', tickers: ['GOOGL'] }),
      makeSignal({ title: 'Broadcom, Google sign AI chip deal through 2031', tickers: ['GOOGL'] }),
    ];
    const result = deduplicateByTitle(signals);
    expect(result).toHaveLength(1);
  });

  it('keeps signals with different topics for same ticker', () => {
    const signals = [
      makeSignal({ title: 'Google launches new Gemini AI model', tickers: ['GOOGL'] }),
      makeSignal({ title: 'Google faces antitrust ruling in EU', tickers: ['GOOGL'] }),
    ];
    const result = deduplicateByTitle(signals);
    expect(result).toHaveLength(2);
  });

  it('deduplicates identical titles even across different tickers', () => {
    const signals = [
      makeSignal({ title: 'Q1 earnings beat analyst estimates', tickers: ['AAPL'] }),
      makeSignal({ title: 'Q1 earnings beat analyst estimates', tickers: ['MSFT'] }),
    ];
    const result = deduplicateByTitle(signals);
    expect(result).toHaveLength(1);
  });

  it('keeps the higher confidence signal in fuzzy dedup', () => {
    const signals = [
      makeSignal({ title: 'Broadcom, Google sign AI chip deal through 2031', tickers: ['GOOGL'], confidence: 0.6 }),
      makeSignal({ title: 'Google, Broadcom sign five-year AI chip deal', tickers: ['GOOGL'], confidence: 0.9 }),
    ];
    const result = deduplicateByTitle(signals);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(0.9);
  });

  it('returns empty array for empty input', () => {
    expect(deduplicateByTitle([])).toHaveLength(0);
  });

  it('returns single signal unchanged', () => {
    const signals = [makeSignal({ title: 'AAPL hits all-time high' })];
    const result = deduplicateByTitle(signals);
    expect(result).toHaveLength(1);
  });
});
