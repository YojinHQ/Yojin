import type { Entity } from '@yojinhq/jintel-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
          changePercent: 9.0,
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

describe('enrichmentToSignals — key events publishedAt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-08T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses day-precision ingestion time, not event date', () => {
    const entity = makeEntity({
      market: {
        keyEvents: [
          {
            type: 'FIFTY_TWO_WEEK_HIGH',
            date: '2026-04-05',
            description: 'Apple hit a 52-week high',
            close: 200.0,
            changePercent: 2.5,
            priceChange: 5.0,
          },
        ],
      },
    });

    const signals = enrichmentToSignals(entity, ['AAPL']);
    const keyEventSignals = signals.filter((s) => s.sourceId === 'jintel-key-event');

    expect(keyEventSignals).toHaveLength(1);
    expect(keyEventSignals[0].publishedAt).toBe('2026-04-08T00:00:00.000Z');
    expect(keyEventSignals[0].metadata?.eventDate).toBe('2026-04-05');
  });

  it('skips events older than 7 days', () => {
    const entity = makeEntity({
      market: {
        keyEvents: [
          {
            type: 'FIFTY_TWO_WEEK_HIGH',
            date: '2025-11-06',
            description: 'Old 52-week high',
            close: 180.0,
            changePercent: 1.0,
            priceChange: 2.0,
          },
        ],
      },
    });

    const signals = enrichmentToSignals(entity, ['AAPL']);
    const keyEventSignals = signals.filter((s) => s.sourceId === 'jintel-key-event');

    expect(keyEventSignals).toHaveLength(0);
  });

  it('produces stable hash across re-runs on the same day', () => {
    const entity = makeEntity({
      market: {
        keyEvents: [
          {
            type: 'VOLUME_SPIKE',
            date: '2026-04-07',
            description: 'Volume spike detected',
            close: 195.0,
            changePercent: 3.0,
            priceChange: 6.0,
            volume: 150000000,
          },
        ],
      },
    });

    const first = enrichmentToSignals(entity, ['AAPL']);
    const second = enrichmentToSignals(entity, ['AAPL']);
    const firstEvent = first.filter((s) => s.sourceId === 'jintel-key-event');
    const secondEvent = second.filter((s) => s.sourceId === 'jintel-key-event');

    expect(firstEvent[0].publishedAt).toBe(secondEvent[0].publishedAt);
    expect(firstEvent[0].title).toBe(secondEvent[0].title);
  });
});
