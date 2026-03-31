import type { Entity } from '@yojinhq/jintel-client';
import { describe, expect, it } from 'vitest';

import { enrichmentToSignals } from '../../src/jintel/signal-fetcher.js';

/** Minimal entity with only the fields needed for a given test. */
function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 'test-entity',
    name: 'Apple',
    type: 'COMPANY',
    ...overrides,
  };
}

describe('enrichmentToSignals — signal type classification', () => {
  it('tags news articles as NEWS', () => {
    const entity = makeEntity({
      news: [
        {
          title: 'Apple Earnings Beat Expectations',
          link: 'https://example.com/article',
          snippet: 'Apple reported strong Q4 earnings',
          source: 'Reuters',
        },
      ],
    });

    const signals = enrichmentToSignals(entity, ['AAPL']);
    const newsSignals = signals.filter((s) => s.sourceName?.includes('Jintel News'));

    expect(newsSignals).toHaveLength(1);
    expect(newsSignals[0].type).toBe('NEWS');
  });

  it('tags research articles as NEWS', () => {
    const entity = makeEntity({
      research: [
        {
          title: 'Deep Dive: Apple Revenue Growth Analysis',
          url: 'https://example.com/research',
          text: 'A comprehensive analysis of Apple revenue growth',
          score: 0.9,
        },
      ],
    });

    const signals = enrichmentToSignals(entity, ['AAPL']);
    const researchSignals = signals.filter((s) => s.sourceName === 'Jintel Research');

    expect(researchSignals).toHaveLength(1);
    expect(researchSignals[0].type).toBe('NEWS');
  });

  it('tags SEC filings as FILINGS', () => {
    const entity = makeEntity({
      regulatory: {
        sanctions: [],
        filings: [
          {
            type: '10-K',
            date: '2026-03-15',
            description: 'Annual report',
            url: 'https://sec.gov/filing/123',
          },
        ],
      },
    });

    const signals = enrichmentToSignals(entity, ['AAPL']);
    const filingSignals = signals.filter((s) => s.sourceName === 'Jintel SEC');

    expect(filingSignals).toHaveLength(1);
    expect(filingSignals[0].type).toBe('FILINGS');
  });

  it('tags snapshot (price + fundamentals) as FUNDAMENTAL', () => {
    const entity = makeEntity({
      market: {
        quote: {
          ticker: 'AAPL',
          price: 150.0,
          change: 1.5,
          changePercent: 1.0,
          volume: 50000000,
          timestamp: '2026-03-31T16:00:00Z',
          source: 'yahoo',
        },
      },
    });

    const signals = enrichmentToSignals(entity, ['AAPL']);
    const snapshotSignals = signals.filter((s) => s.sourceId === 'jintel-snapshot');

    expect(snapshotSignals).toHaveLength(1);
    expect(snapshotSignals[0].type).toBe('FUNDAMENTAL');
  });

  it('tags significant price moves as TECHNICAL', () => {
    const entity = makeEntity({
      market: {
        quote: {
          ticker: 'AAPL',
          price: 150.0,
          change: 5.0,
          changePercent: 3.5,
          volume: 80000000,
          timestamp: '2026-03-31T16:00:00Z',
          source: 'yahoo',
        },
      },
    });

    const signals = enrichmentToSignals(entity, ['AAPL']);
    const priceSignals = signals.filter((s) => s.sourceId === 'jintel-market');

    expect(priceSignals).toHaveLength(1);
    expect(priceSignals[0].type).toBe('TECHNICAL');
  });

  it('does not misclassify news with financial keywords as FUNDAMENTAL', () => {
    const entity = makeEntity({
      news: [
        {
          title: 'Apple Earnings Beat Expectations with Record Revenue',
          link: 'https://example.com/earnings',
          snippet: 'EPS came in at $2.10, beating the consensus estimate of $1.95. Revenue was $95B.',
          source: 'Bloomberg',
        },
      ],
    });

    const signals = enrichmentToSignals(entity, ['AAPL']);
    const newsSignals = signals.filter((s) => s.sourceName?.includes('Jintel News'));

    expect(newsSignals).toHaveLength(1);
    expect(newsSignals[0].type).toBe('NEWS');
    expect(newsSignals[0].type).not.toBe('FUNDAMENTAL');
  });
});
