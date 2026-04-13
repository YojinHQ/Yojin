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
    const newsSignals = signals.filter((s) => s.sourceId?.includes('jintel-news'));

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
    const researchSignals = signals.filter((s) => s.sourceName === 'Research');

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
    const filingSignals = signals.filter((s) => s.sourceName === 'SEC Filings');

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
    const newsSignals = signals.filter((s) => s.sourceId?.includes('jintel-news'));

    expect(newsSignals).toHaveLength(1);
    expect(newsSignals[0].type).toBe('NEWS');
    expect(newsSignals[0].type).not.toBe('FUNDAMENTAL');
  });
});

describe('enrichmentToSignals — ticker-content mismatch filter', () => {
  it('drops HN discussion where ticker appears only as product name substring ("Flash Lite" → LITE)', () => {
    const entity = makeEntity({
      name: 'Lumentum Holdings',
      discussions: [
        {
          objectId: 'hn-123',
          title: 'AI model writing similarity study questions pricing power',
          url: 'https://example.com/article',
          hnUrl: 'https://news.ycombinator.com/item?id=123',
          points: 50,
          numComments: 30,
          topComments: [{ text: 'Gemini 2.5 Flash Lite performs surprisingly well for the price' }],
        },
      ],
    });

    const signals = enrichmentToSignals(entity, ['LITE']);
    const hnSignals = signals.filter((s) => s.sourceName === 'Hacker News');

    expect(hnSignals).toHaveLength(0);
  });

  it('drops news article about unrelated company (Flock Safety → FLY)', () => {
    const entity = makeEntity({
      name: 'Firefly Aerospace',
      news: [
        {
          title: 'Flock Safety raises $275M to expand surveillance network',
          link: 'https://example.com/flock',
          snippet: 'Flock Safety, the license plate reader company, announced a new funding round.',
          source: 'TechCrunch',
        },
      ],
    });

    const signals = enrichmentToSignals(entity, ['FLY']);
    const newsSignals = signals.filter((s) => s.sourceId?.includes('jintel-news'));

    expect(newsSignals).toHaveLength(0);
  });

  it('keeps news article that mentions the ticker as a standalone symbol', () => {
    const entity = makeEntity({
      name: 'Firefly Aerospace',
      news: [
        {
          title: 'FLY stock surges after successful lunar lander mission',
          link: 'https://example.com/fly-launch',
          snippet: 'Firefly Aerospace shares jumped 15% after its Blue Ghost lander touched down.',
          source: 'Reuters',
        },
      ],
    });

    const signals = enrichmentToSignals(entity, ['FLY']);
    const newsSignals = signals.filter((s) => s.sourceId?.includes('jintel-news'));

    expect(newsSignals).toHaveLength(1);
  });

  it('keeps news article that mentions the entity name', () => {
    const entity = makeEntity({
      name: 'Lumentum Holdings',
      news: [
        {
          title: 'Lumentum Holdings reports Q2 earnings above estimates',
          link: 'https://example.com/lumentum',
          snippet: 'Lumentum delivered strong results driven by fiber optic demand.',
          source: 'Bloomberg',
        },
      ],
    });

    const signals = enrichmentToSignals(entity, ['LITE']);
    const newsSignals = signals.filter((s) => s.sourceId?.includes('jintel-news'));

    expect(newsSignals).toHaveLength(1);
  });

  it('keeps research article with cashtag ticker reference ($LITE)', () => {
    const entity = makeEntity({
      name: 'Lumentum Holdings',
      research: [
        {
          title: 'Analysis: $LITE positioned for AI networking growth',
          url: 'https://example.com/research',
          text: '$LITE benefits from data center buildout cycle.',
          score: 0.85,
        },
      ],
    });

    const signals = enrichmentToSignals(entity, ['LITE']);
    const researchSignals = signals.filter((s) => s.sourceName === 'Research');

    expect(researchSignals).toHaveLength(1);
  });

  it('keeps short ticker when mentioned as cashtag ($FLY)', () => {
    const entity = makeEntity({
      name: 'Firefly Aerospace',
      news: [
        {
          title: 'Is $FLY the next space play?',
          link: 'https://example.com/fly-analysis',
          snippet: 'Retail investors are watching this lunar lander stock.',
          source: 'SeekingAlpha',
        },
      ],
    });

    const signals = enrichmentToSignals(entity, ['FLY']);
    const newsSignals = signals.filter((s) => s.sourceId?.includes('jintel-news'));

    expect(newsSignals).toHaveLength(1);
  });

  it('keeps short ticker when it appears in ALL-CAPS in the text (PLTR)', () => {
    const entity = makeEntity({
      name: 'Palantir Technologies',
      discussions: [
        {
          objectId: 'hn-456',
          title: 'PLTR expands government contracts in Europe',
          url: 'https://example.com/pltr',
          hnUrl: 'https://news.ycombinator.com/item?id=456',
          points: 100,
          numComments: 50,
        },
      ],
    });

    const signals = enrichmentToSignals(entity, ['PLTR']);
    const hnSignals = signals.filter((s) => s.sourceName === 'Hacker News');

    expect(hnSignals).toHaveLength(1); // "PLTR" in ALL-CAPS → intentional ticker reference
  });

  it('keeps 5-char ticker on bare word-boundary match without entity name', () => {
    const entity = makeEntity({
      name: 'NovaBay Pharmaceuticals',
      news: [
        {
          title: 'NBAYF reports positive trial results',
          link: 'https://example.com/nbayf',
          snippet: 'The biotech company reported promising Phase 2 data.',
          source: 'Reuters',
        },
      ],
    });

    const signals = enrichmentToSignals(entity, ['NBAYF']);
    const newsSignals = signals.filter((s) => s.sourceId?.includes('jintel-news'));

    expect(newsSignals).toHaveLength(1);
  });

  it('keeps article mentioning company name without ticker (Nvidia → NVDA)', () => {
    const entity = makeEntity({
      name: 'NVIDIA Corporation',
      news: [
        {
          title: 'Nvidia reports record data center revenue',
          link: 'https://example.com/nvidia-earnings',
          snippet: 'Nvidia beat expectations with $35B in data center sales.',
          source: 'Reuters',
        },
      ],
    });

    const signals = enrichmentToSignals(entity, ['NVDA']);
    const newsSignals = signals.filter((s) => s.sourceId?.includes('jintel-news'));

    expect(newsSignals).toHaveLength(1);
  });

  it('keeps article mentioning company name with corporate suffix stripped (Tesla Inc → TSLA)', () => {
    const entity = makeEntity({
      name: 'Tesla Inc',
      news: [
        {
          title: 'Tesla Cybertruck deliveries accelerate in Q2',
          link: 'https://example.com/tesla',
          snippet: 'Tesla delivered 50,000 Cybertrucks in the quarter.',
          source: 'Bloomberg',
        },
      ],
    });

    const signals = enrichmentToSignals(entity, ['TSLA']);
    const newsSignals = signals.filter((s) => s.sourceId?.includes('jintel-news'));

    expect(newsSignals).toHaveLength(1);
  });

  it('drops news article about OpenAI when ticker is OPEN (Opendoor) — substring false match', () => {
    const entity = makeEntity({
      name: 'Opendoor Technologies',
      news: [
        {
          title: 'OpenAI confirms security issue',
          link: 'https://example.com/openai-security',
          snippet: 'OpenAI disclosed a security breach affecting ChatGPT user data.',
          source: 'TechCrunch',
        },
      ],
    });

    const signals = enrichmentToSignals(entity, ['OPEN']);
    const newsSignals = signals.filter((s) => s.sourceId?.includes('jintel-news'));

    expect(newsSignals).toHaveLength(0);
  });

  it('drops Reddit post about OpenAI when ticker is OPEN (Opendoor)', () => {
    const entity = makeEntity({
      name: 'Opendoor Technologies',
      social: {
        reddit: [
          {
            id: 'openai-post',
            title: 'OpenAI confirms security issue in ChatGPT',
            subreddit: 'technology',
            author: 'tech_user',
            score: 200,
            numComments: 50,
            url: '',
            text: 'OpenAI has disclosed a major security vulnerability.',
            date: '2026-04-10T12:00:00Z',
          },
        ],
      },
    });

    const signals = enrichmentToSignals(entity, ['OPEN']);
    const redditSignals = signals.filter((s) => s.sourceId.includes('reddit'));

    expect(redditSignals).toHaveLength(0);
  });

  it('drops research article with no ticker or entity name reference', () => {
    const entity = makeEntity({
      name: 'Firefly Aerospace',
      research: [
        {
          title: 'The Future of Urban Air Mobility',
          url: 'https://example.com/uam',
          text: 'Electric VTOL aircraft are reshaping transportation.',
          score: 0.8,
        },
      ],
    });

    const signals = enrichmentToSignals(entity, ['FLY']);
    const researchSignals = signals.filter((s) => s.sourceName === 'Research');

    expect(researchSignals).toHaveLength(0);
  });
});

describe('enrichmentToSignals — Reddit source attribution', () => {
  it('attributes link posts to the original article domain', () => {
    const entity = makeEntity({
      social: {
        reddit: [
          {
            id: 'abc123',
            title: 'ETH network activity near ATH at $2,130',
            subreddit: 'CryptoCurrency',
            author: 'crypto_user',
            score: 50,
            numComments: 30,
            url: 'https://www.ethnews.com/ethereum-network-activity-near-all-time-high-as-eth-hits-2130/',
            text: 'Interesting article about ETH activity',
            date: '2026-04-10T12:00:00Z',
          },
        ],
      },
    });

    const signals = enrichmentToSignals(entity, ['ETH']);
    const reddit = signals.filter((s) => s.sourceId.includes('reddit'));

    expect(reddit).toHaveLength(1);
    expect(reddit[0].sourceName).toBe('ethnews.com (via r/CryptoCurrency)');
    expect(reddit[0].type).toBe('NEWS');
    expect(reddit[0].link).toBe(
      'https://www.ethnews.com/ethereum-network-activity-near-all-time-high-as-eth-hits-2130/',
    );
    expect(reddit[0].metadata?.redditPostId).toBe('abc123');
  });

  it('treats Reddit media URLs (i.redd.it, v.redd.it) as self-posts', () => {
    const entity = makeEntity({
      social: {
        reddit: [
          {
            id: 'img001',
            title: 'BTC chart looking bullish',
            subreddit: 'Bitcoin',
            author: 'chart_guy',
            score: 100,
            numComments: 20,
            url: 'https://i.redd.it/abc123.png',
            text: 'Look at this chart',
            date: '2026-04-10T10:00:00Z',
          },
        ],
      },
    });

    const signals = enrichmentToSignals(entity, ['BTC']);
    const reddit = signals.filter((s) => s.sourceId.includes('reddit'));

    expect(reddit).toHaveLength(1);
    expect(reddit[0].sourceName).toBe('Reddit (r/Bitcoin)');
    expect(reddit[0].type).toBe('SOCIALS');
  });

  it('keeps self-posts attributed to the subreddit', () => {
    const entity = makeEntity({
      social: {
        reddit: [
          {
            id: 'def456',
            title: 'What do you think about ETH staking?',
            subreddit: 'CryptoCurrency',
            author: 'eth_fan',
            score: 20,
            numComments: 15,
            url: 'https://reddit.com/r/CryptoCurrency/comments/def456/what_do_you_think_about_eth_staking/',
            text: 'I have been staking ETH and wondering what others think.',
            date: '2026-04-10T14:00:00Z',
          },
        ],
      },
    });

    const signals = enrichmentToSignals(entity, ['ETH']);
    const reddit = signals.filter((s) => s.sourceId.includes('reddit'));

    expect(reddit).toHaveLength(1);
    expect(reddit[0].sourceName).toBe('Reddit (r/CryptoCurrency)');
    expect(reddit[0].type).toBe('SOCIALS');
    expect(reddit[0].metadata?.redditPostId).toBeUndefined();
  });
});
