import { describe, expect, it } from 'vitest';

import { detectConvergence } from '../../../src/signals/curation/convergence-detector.js';
import type { Signal } from '../../../src/signals/types.js';

const NOW = Date.now();
const HOUR = 60 * 60 * 1000;

function makeSignal(id: string, sourceId: string, ticker: string, hoursAgo: number = 0): Signal {
  return {
    id,
    contentHash: `hash-${id}`,
    type: 'NEWS',
    title: `Signal ${id}`,
    assets: [{ ticker, relevance: 0.8, linkType: 'DIRECT' }],
    sources: [{ id: sourceId, name: 'Test', type: 'API', reliability: 0.7 }],
    publishedAt: new Date(NOW - hoursAgo * HOUR).toISOString(),
    ingestedAt: new Date(NOW - hoursAgo * HOUR).toISOString(),
    confidence: 0.7,
    outputType: 'INSIGHT',
    version: 1,
  };
}

describe('detectConvergence', () => {
  it('returns no boost when fewer than 3 sources discuss a ticker', () => {
    const signals = [
      makeSignal('1', 'jintel-social-twitter-1', 'AAPL', 1),
      makeSignal('2', 'jintel-social-reddit-1', 'AAPL', 2),
    ];
    const result = detectConvergence(signals);
    expect(result.boosts.size).toBe(0);
    expect(result.tickerSourceCounts.get('AAPL')).toBe(2);
  });

  it('returns 0.15 boost when 3 sources converge', () => {
    const signals = [
      makeSignal('1', 'jintel-social-twitter-1', 'AAPL', 1),
      makeSignal('2', 'jintel-social-reddit-1', 'AAPL', 2),
      makeSignal('3', 'jintel-news-art1', 'AAPL', 3),
    ];
    const result = detectConvergence(signals);
    expect(result.boosts.get('1')).toBe(0.15);
    expect(result.boosts.get('2')).toBe(0.15);
    expect(result.boosts.get('3')).toBe(0.15);
    expect(result.tickerSourceCounts.get('AAPL')).toBe(3);
  });

  it('returns 0.25 boost when 4 sources converge', () => {
    const signals = [
      makeSignal('1', 'jintel-social-twitter-1', 'AAPL', 1),
      makeSignal('2', 'jintel-social-reddit-1', 'AAPL', 2),
      makeSignal('3', 'jintel-news-art1', 'AAPL', 3),
      makeSignal('4', 'jintel-social-youtube-1', 'AAPL', 4),
    ];
    const result = detectConvergence(signals);
    expect(result.boosts.get('1')).toBe(0.25);
    expect(result.tickerSourceCounts.get('AAPL')).toBe(4);
  });

  it('returns 0.35 boost when 5+ sources converge', () => {
    const signals = [
      makeSignal('1', 'jintel-social-twitter-1', 'AAPL', 1),
      makeSignal('2', 'jintel-social-reddit-1', 'AAPL', 2),
      makeSignal('3', 'jintel-news-art1', 'AAPL', 3),
      makeSignal('4', 'jintel-social-youtube-1', 'AAPL', 4),
      makeSignal('5', 'jintel-discussions-hn-1', 'AAPL', 5),
    ];
    const result = detectConvergence(signals);
    expect(result.boosts.get('1')).toBe(0.35);
    expect(result.tickerSourceCounts.get('AAPL')).toBe(5);
  });

  it('does not count multiple signals from the same source bucket', () => {
    const signals = [
      makeSignal('1', 'jintel-social-twitter-1', 'AAPL', 1),
      makeSignal('2', 'jintel-social-twitter-2', 'AAPL', 2),
      makeSignal('3', 'jintel-social-twitter-3', 'AAPL', 3),
    ];
    const result = detectConvergence(signals);
    expect(result.boosts.size).toBe(0);
    expect(result.tickerSourceCounts.get('AAPL')).toBe(1); // all twitter = 1 bucket
  });

  it('only counts signals within the time window', () => {
    const signals = [
      makeSignal('1', 'jintel-social-twitter-1', 'AAPL', 1), // 1h ago
      makeSignal('2', 'jintel-social-reddit-1', 'AAPL', 2), // 2h ago
      makeSignal('3', 'jintel-news-art1', 'AAPL', 48), // 48h ago — outside 24h window
    ];
    const result = detectConvergence(signals);
    expect(result.boosts.size).toBe(0); // only 2 sources within window
  });

  it('handles multiple tickers independently', () => {
    const signals = [
      makeSignal('1', 'jintel-social-twitter-1', 'AAPL', 1),
      makeSignal('2', 'jintel-social-reddit-1', 'AAPL', 2),
      makeSignal('3', 'jintel-news-art1', 'AAPL', 3),
      makeSignal('4', 'jintel-social-twitter-2', 'TSLA', 1),
      makeSignal('5', 'jintel-social-reddit-2', 'TSLA', 2),
    ];
    const result = detectConvergence(signals);
    expect(result.tickerSourceCounts.get('AAPL')).toBe(3);
    expect(result.tickerSourceCounts.get('TSLA')).toBe(2);
    expect(result.boosts.get('1')).toBe(0.15); // AAPL converges
    expect(result.boosts.has('4')).toBe(false); // TSLA does not
  });

  it('returns empty results for no signals', () => {
    const result = detectConvergence([]);
    expect(result.boosts.size).toBe(0);
    expect(result.tickerSourceCounts.size).toBe(0);
  });
});
