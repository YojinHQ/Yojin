import { describe, expect, it } from 'vitest';

import { computeEngagementScore } from '../../../src/signals/curation/engagement-scorer.js';
import type { Signal } from '../../../src/signals/types.js';

function makeSignal(sourceId: string, metadata: Record<string, unknown>): Signal {
  return {
    id: 'test-1',
    contentHash: 'hash-1',
    type: 'SOCIALS',
    title: 'Test signal',
    assets: [{ ticker: 'AAPL', relevance: 0.8, linkType: 'DIRECT' }],
    sources: [{ id: sourceId, name: 'Test', type: 'API', reliability: 0.7 }],
    publishedAt: new Date().toISOString(),
    ingestedAt: new Date().toISOString(),
    confidence: 0.7,
    metadata,
    outputType: 'INSIGHT',
    version: 1,
  };
}

describe('computeEngagementScore', () => {
  it('scores Twitter signals by likes and retweets', () => {
    const signal = makeSignal('jintel-social-twitter-123', { likes: 1000, retweets: 200 });
    const score = computeEngagementScore(signal);
    expect(score).toBeGreaterThan(0.4);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('scores high-engagement Twitter higher than low-engagement', () => {
    const low = makeSignal('jintel-social-twitter-1', { likes: 10, retweets: 2 });
    const high = makeSignal('jintel-social-twitter-2', { likes: 5000, retweets: 1000 });
    expect(computeEngagementScore(high)).toBeGreaterThan(computeEngagementScore(low));
  });

  it('scores Reddit signals by score and comments', () => {
    const signal = makeSignal('jintel-social-reddit-abc', { score: 500, numComments: 100 });
    const score = computeEngagementScore(signal);
    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('scores YouTube signals by view count', () => {
    const signal = makeSignal('jintel-social-youtube-vid1', { viewCount: 100_000 });
    const score = computeEngagementScore(signal);
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('scores LinkedIn signals by likes and comments', () => {
    const signal = makeSignal('jintel-social-linkedin-post1', { likes: 200, comments: 30 });
    const score = computeEngagementScore(signal);
    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('scores HN signals by points and comments', () => {
    const signal = makeSignal('jintel-discussions-hn-123', { points: 100, numComments: 50 });
    const score = computeEngagementScore(signal);
    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('scores research signals by relevance score', () => {
    const signal = makeSignal('jintel-research-art1', { score: 0.85 });
    signal.type = 'NEWS';
    const score = computeEngagementScore(signal);
    expect(score).toBe(0.85);
  });

  it('returns 0 for unknown source types', () => {
    const signal = makeSignal('jintel-fundamental-snap', { pe: 25 });
    expect(computeEngagementScore(signal)).toBe(0);
  });

  it('returns 0 when metadata is missing', () => {
    const signal = makeSignal('jintel-social-twitter-1', {});
    signal.metadata = undefined;
    expect(computeEngagementScore(signal)).toBe(0);
  });

  it('handles zero engagement gracefully', () => {
    const signal = makeSignal('jintel-social-twitter-1', { likes: 0, retweets: 0 });
    expect(computeEngagementScore(signal)).toBe(0);
  });

  it('caps at 1.0 for extremely high engagement', () => {
    const signal = makeSignal('jintel-social-twitter-1', { likes: 1_000_000, retweets: 500_000 });
    expect(computeEngagementScore(signal)).toBeLessThanOrEqual(1);
  });
});
