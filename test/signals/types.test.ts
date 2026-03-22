import { describe, expect, it } from 'vitest';

import {
  AssetSchema,
  LinkTypeSchema,
  PortfolioRelevanceScoreSchema,
  SignalAssetLinkSchema,
  SignalDataSourceSchema,
  SignalIndexEntrySchema,
  SignalIndexSchema,
  SignalSchema,
  SignalTypeSchema,
  SourceTypeSchema,
} from '../../src/signals/index.js';

// ---------------------------------------------------------------------------
// Enum schemas
// ---------------------------------------------------------------------------

describe('SignalTypeSchema', () => {
  it('accepts valid signal types', () => {
    for (const t of ['NEWS', 'FUNDAMENTAL', 'SENTIMENT', 'TECHNICAL', 'MACRO']) {
      expect(SignalTypeSchema.parse(t)).toBe(t);
    }
  });

  it('rejects lowercase signal types', () => {
    expect(() => SignalTypeSchema.parse('news')).toThrow();
  });

  it('rejects unknown signal types', () => {
    expect(() => SignalTypeSchema.parse('WEATHER')).toThrow();
  });
});

describe('SourceTypeSchema', () => {
  it('accepts valid source types', () => {
    for (const t of ['API', 'RSS', 'SCRAPER', 'ENRICHMENT']) {
      expect(SourceTypeSchema.parse(t)).toBe(t);
    }
  });

  it('rejects invalid source types', () => {
    expect(() => SourceTypeSchema.parse('DATABASE')).toThrow();
  });
});

describe('LinkTypeSchema', () => {
  it('accepts valid link types', () => {
    for (const t of ['DIRECT', 'INDIRECT', 'MACRO']) {
      expect(LinkTypeSchema.parse(t)).toBe(t);
    }
  });

  it('rejects invalid link types', () => {
    expect(() => LinkTypeSchema.parse('TANGENTIAL')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SignalDataSource
// ---------------------------------------------------------------------------

describe('SignalDataSourceSchema', () => {
  const validSource = {
    id: 'openbb-fmp',
    name: 'FMP via OpenBB',
    type: 'API',
    reliability: 0.9,
  };

  it('parses a valid data source', () => {
    const result = SignalDataSourceSchema.parse(validSource);
    expect(result.id).toBe('openbb-fmp');
    expect(result.reliability).toBe(0.9);
  });

  it('rejects reliability > 1', () => {
    expect(() => SignalDataSourceSchema.parse({ ...validSource, reliability: 1.5 })).toThrow();
  });

  it('rejects reliability < 0', () => {
    expect(() => SignalDataSourceSchema.parse({ ...validSource, reliability: -0.1 })).toThrow();
  });

  it('rejects invalid source type', () => {
    expect(() => SignalDataSourceSchema.parse({ ...validSource, type: 'WEBHOOK' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Asset
// ---------------------------------------------------------------------------

describe('AssetSchema', () => {
  it('parses a minimal asset', () => {
    const result = AssetSchema.parse({ ticker: 'AAPL', assetClass: 'EQUITY' });
    expect(result.ticker).toBe('AAPL');
    expect(result.name).toBeUndefined();
  });

  it('parses a full asset', () => {
    const result = AssetSchema.parse({
      ticker: 'AAPL',
      name: 'Apple Inc.',
      assetClass: 'EQUITY',
      exchange: 'NASDAQ',
      sector: 'Technology',
      industry: 'Consumer Electronics',
    });
    expect(result.sector).toBe('Technology');
  });

  it('rejects invalid asset class', () => {
    expect(() => AssetSchema.parse({ ticker: 'AAPL', assetClass: 'STOCK' })).toThrow();
  });

  it('rejects missing ticker', () => {
    expect(() => AssetSchema.parse({ assetClass: 'EQUITY' })).toThrow();
  });

  it('rejects empty-string ticker', () => {
    expect(() => AssetSchema.parse({ ticker: '', assetClass: 'EQUITY' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SignalAssetLink
// ---------------------------------------------------------------------------

describe('SignalAssetLinkSchema', () => {
  it('parses a valid link', () => {
    const result = SignalAssetLinkSchema.parse({
      ticker: 'AAPL',
      relevance: 0.95,
      linkType: 'DIRECT',
    });
    expect(result.linkType).toBe('DIRECT');
  });

  it('rejects relevance out of range', () => {
    expect(() => SignalAssetLinkSchema.parse({ ticker: 'AAPL', relevance: 2.0, linkType: 'DIRECT' })).toThrow();
  });

  it('rejects empty-string ticker', () => {
    expect(() => SignalAssetLinkSchema.parse({ ticker: '', relevance: 0.5, linkType: 'DIRECT' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Signal
// ---------------------------------------------------------------------------

describe('SignalSchema', () => {
  const validSignal = {
    id: 'sig_abc123',
    contentHash: 'a1b2c3d4e5f6',
    type: 'NEWS',
    title: 'Fed holds rates steady',
    content: 'The Federal Reserve kept interest rates unchanged...',
    assets: [
      { ticker: 'SPY', relevance: 0.9, linkType: 'MACRO' },
      { ticker: 'AAPL', relevance: 0.3, linkType: 'INDIRECT' },
    ],
    sources: [{ id: 'rss-reuters', name: 'Reuters RSS', type: 'RSS', reliability: 0.95 }],
    publishedAt: '2026-03-21T10:00:00.000Z',
    ingestedAt: '2026-03-21T10:01:30.000Z',
    confidence: 0.85,
    metadata: { category: 'monetary-policy' },
  };

  it('parses a valid signal with multiple assets', () => {
    const result = SignalSchema.parse(validSignal);
    expect(result.assets).toHaveLength(2);
    expect(result.sources).toHaveLength(1);
    expect(result.type).toBe('NEWS');
  });

  it('parses a signal without optional fields', () => {
    const { content: _content, metadata: _metadata, ...minimal } = validSignal;
    const result = SignalSchema.parse(minimal);
    expect(result.content).toBeUndefined();
    expect(result.metadata).toBeUndefined();
  });

  it('rejects missing required fields', () => {
    expect(() => SignalSchema.parse({ id: 'sig_1' })).toThrow();
  });

  it('rejects invalid signal type', () => {
    expect(() => SignalSchema.parse({ ...validSignal, type: 'WEATHER' })).toThrow();
  });

  it('rejects invalid datetime format', () => {
    expect(() => SignalSchema.parse({ ...validSignal, publishedAt: 'not-a-date' })).toThrow();
  });

  it('rejects confidence out of range', () => {
    expect(() => SignalSchema.parse({ ...validSignal, confidence: 1.5 })).toThrow();
  });

  it('accepts empty assets array', () => {
    const result = SignalSchema.parse({ ...validSignal, assets: [] });
    expect(result.assets).toHaveLength(0);
  });

  it('rejects empty sources array', () => {
    expect(() => SignalSchema.parse({ ...validSignal, sources: [] })).toThrow();
  });

  it('rejects empty-string id', () => {
    expect(() => SignalSchema.parse({ ...validSignal, id: '' })).toThrow();
  });

  it('rejects empty-string contentHash', () => {
    expect(() => SignalSchema.parse({ ...validSignal, contentHash: '' })).toThrow();
  });

  it('rejects empty-string title', () => {
    expect(() => SignalSchema.parse({ ...validSignal, title: '' })).toThrow();
  });

  it('validates nested asset link schemas', () => {
    expect(() =>
      SignalSchema.parse({
        ...validSignal,
        assets: [{ ticker: 'AAPL', relevance: 5, linkType: 'DIRECT' }],
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// PortfolioRelevanceScore
// ---------------------------------------------------------------------------

describe('PortfolioRelevanceScoreSchema', () => {
  it('parses a valid score', () => {
    const result = PortfolioRelevanceScoreSchema.parse({
      signalId: 'sig_abc123',
      ticker: 'AAPL',
      exposureWeight: 0.4,
      typeRelevance: 0.8,
      compositeScore: 0.72,
    });
    expect(result.compositeScore).toBe(0.72);
    expect(result.ticker).toBe('AAPL');
  });

  it('rejects score values > 1', () => {
    expect(() =>
      PortfolioRelevanceScoreSchema.parse({
        signalId: 'sig_abc123',
        ticker: 'AAPL',
        exposureWeight: 0.4,
        typeRelevance: 0.8,
        compositeScore: 1.5,
      }),
    ).toThrow();
  });

  it('rejects missing ticker', () => {
    expect(() =>
      PortfolioRelevanceScoreSchema.parse({
        signalId: 'sig_abc123',
        exposureWeight: 0.4,
        typeRelevance: 0.8,
        compositeScore: 0.72,
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SignalIndex
// ---------------------------------------------------------------------------

describe('SignalIndexSchema', () => {
  it('parses a valid index', () => {
    const result = SignalIndexSchema.parse({
      entries: [
        {
          id: 'sig_abc123',
          contentHash: 'a1b2c3',
          type: 'NEWS',
          tickers: ['AAPL', 'SPY'],
          portfolioScore: 0.72,
          publishedAt: '2026-03-21T10:00:00.000Z',
          ingestedAt: '2026-03-21T10:01:30.000Z',
        },
      ],
      lastUpdated: '2026-03-21T10:01:30.000Z',
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].tickers).toContain('AAPL');
  });

  it('parses an empty index', () => {
    const result = SignalIndexSchema.parse({
      entries: [],
      lastUpdated: '2026-03-21T10:00:00.000Z',
    });
    expect(result.entries).toHaveLength(0);
  });

  it('rejects empty-string ticker in tickers array', () => {
    expect(() =>
      SignalIndexEntrySchema.parse({
        id: 'sig_1',
        contentHash: 'abc',
        type: 'NEWS',
        tickers: ['', 'AAPL'],
        publishedAt: '2026-03-21T10:00:00.000Z',
        ingestedAt: '2026-03-21T10:01:00.000Z',
      }),
    ).toThrow();
  });

  it('accepts entry without optional portfolioScore', () => {
    const result = SignalIndexEntrySchema.parse({
      id: 'sig_1',
      contentHash: 'abc',
      type: 'SENTIMENT',
      tickers: ['BTC-USD'],
      publishedAt: '2026-03-21T10:00:00.000Z',
      ingestedAt: '2026-03-21T10:01:00.000Z',
    });
    expect(result.portfolioScore).toBeUndefined();
  });
});
