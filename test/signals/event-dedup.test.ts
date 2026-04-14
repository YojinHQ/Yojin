import { describe, expect, it } from 'vitest';

import { deduplicateByEvent, extractEventFingerprint } from '../../src/signals/signal-filter.js';
import type { Signal } from '../../src/signals/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _counter = 0;

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  _counter++;
  return {
    id: `sig-${_counter.toString().padStart(3, '0')}`,
    contentHash: `hash-${_counter}`,
    type: 'NEWS',
    title: `Signal ${_counter}`,
    assets: [{ ticker: 'AAPL', relevance: 0.9, linkType: 'DIRECT' }],
    sources: [{ id: `source-${_counter}`, name: `Source ${_counter}`, type: 'API' as const, reliability: 0.85 }],
    publishedAt: '2026-04-11T10:00:00.000Z',
    ingestedAt: '2026-04-11T10:01:00.000Z',
    confidence: 0.85,
    outputType: 'INSIGHT',
    version: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// extractEventFingerprint
// ---------------------------------------------------------------------------

describe('extractEventFingerprint', () => {
  it('detects earnings-related titles', () => {
    expect(extractEventFingerprint('AEHR Q3 2026 Earnings Call Transcript Published')).toBe('EARNINGS');
    expect(extractEventFingerprint('AEHR Q3 Loss Beats, But Sales Miss Consensus')).toBe('EARNINGS');
    expect(extractEventFingerprint('AEHR bookings surge 6x QoQ, backlog strengthens to $50.9M')).toBe('EARNINGS');
    expect(extractEventFingerprint('AEHR Q3 Bookings $37.2M; Maintains FY26 Loss Guidance')).toBe('EARNINGS');
    expect(extractEventFingerprint('AEHR Q3 revenue miss offset by record bookings, AI demand')).toBe('EARNINGS');
    expect(extractEventFingerprint('AEHR Q-Results Miss, Backlog Hits Records, Stock Fully Valued')).toBe('EARNINGS');
    expect(extractEventFingerprint('Apple reports strong Q3 earnings')).toBe('EARNINGS');
    expect(extractEventFingerprint('AAPL beats Q3 estimates on EPS')).toBe('EARNINGS');
    expect(extractEventFingerprint('TSLA Q2 FY25 revenue guidance raised')).toBe('EARNINGS');
  });

  it('detects analyst-related titles', () => {
    expect(extractEventFingerprint('Morgan Stanley upgrades AAPL to overweight')).toBe('ANALYST');
    expect(extractEventFingerprint('NVDA downgraded by Goldman Sachs')).toBe('ANALYST');
    expect(extractEventFingerprint('Analyst initiates coverage with price target of $200')).toBe('ANALYST');
  });

  it('detects FDA-related titles', () => {
    expect(extractEventFingerprint('FDA approves MRNA new vaccine')).toBe('FDA');
    expect(extractEventFingerprint('Phase 3 clinical trial results announced')).toBe('FDA');
    expect(extractEventFingerprint('PDUFA date set for October review')).toBe('FDA');
  });

  it('detects M&A-related titles', () => {
    expect(extractEventFingerprint('Google to acquire Wiz for $32B')).toBe('MA');
    expect(extractEventFingerprint('Major merger announced between XYZ and ABC')).toBe('MA');
    expect(extractEventFingerprint('Company takeover bid rejected by board')).toBe('MA');
  });

  it('detects offering-related titles', () => {
    expect(extractEventFingerprint('Company files for IPO')).toBe('OFFERING');
    expect(extractEventFingerprint('Secondary offering priced at $50 per share')).toBe('OFFERING');
  });

  it('returns null for general news', () => {
    expect(extractEventFingerprint('AAPL stock drops 5% after hours')).toBeNull();
    expect(extractEventFingerprint('New product launch expected next month')).toBeNull();
    expect(extractEventFingerprint('CEO interview on CNBC')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// deduplicateByEvent
// ---------------------------------------------------------------------------

describe('deduplicateByEvent', () => {
  it('collapses multiple earnings headlines for the same ticker and day', () => {
    const signals = [
      makeSignal({ title: 'AEHR Q3 Loss Beats, But Sales Miss Consensus', confidence: 0.8 }),
      makeSignal({ title: 'AEHR bookings surge 6x QoQ, backlog strengthens to $50.9M', confidence: 0.75 }),
      makeSignal({ title: 'AEHR Q3 2026 Earnings Call Transcript Published', confidence: 0.7 }),
      makeSignal({ title: 'AEHR Q3 Bookings $37.2M; Maintains FY26 Loss Guidance', confidence: 0.65 }),
      makeSignal({ title: 'AEHR Q3 revenue miss offset by record bookings, AI demand', confidence: 0.6 }),
      makeSignal({
        title: 'AEHR Q-Results Miss, Backlog Hits Records, Stock Fully Valued',
        confidence: 0.55,
      }),
    ].map((s) => ({ ...s, assets: [{ ticker: 'AEHR', relevance: 0.9, linkType: 'DIRECT' as const }] }));

    const result = deduplicateByEvent(signals);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('AEHR Q3 Loss Beats, But Sales Miss Consensus');
  });

  it('keeps the signal with highest qualityScore when available', () => {
    const signals = [
      makeSignal({ title: 'AAPL beats Q3 estimates', confidence: 0.9, qualityScore: 60 }),
      makeSignal({ title: 'Apple reports strong Q3 earnings', confidence: 0.95, qualityScore: 85 }),
    ];

    const result = deduplicateByEvent(signals);
    expect(result).toHaveLength(1);
    // Picks the one with higher qualityScore despite lower confidence
    expect(result[0].title).toBe('Apple reports strong Q3 earnings');
  });

  it('merges sources from dropped cluster members into the kept signal', () => {
    const signals = [
      makeSignal({
        title: 'AAPL Q3 earnings beat',
        confidence: 0.9,
        sources: [{ id: 'reuters', name: 'Reuters', type: 'API', reliability: 0.9 }],
      }),
      makeSignal({
        title: 'Apple Q3 revenue smashes estimates',
        confidence: 0.8,
        sources: [{ id: 'bloomberg', name: 'Bloomberg', type: 'API', reliability: 0.85 }],
      }),
      makeSignal({
        title: 'AAPL beats Q3 EPS guidance',
        confidence: 0.7,
        sources: [{ id: 'cnbc', name: 'CNBC', type: 'API', reliability: 0.8 }],
      }),
    ];

    const result = deduplicateByEvent(signals);
    expect(result).toHaveLength(1);
    expect(result[0].sources).toHaveLength(3);
    expect(result[0].sources.map((s) => s.id)).toEqual(['reuters', 'bloomberg', 'cnbc']);
  });

  it('does not merge duplicate source IDs', () => {
    const signals = [
      makeSignal({
        title: 'AAPL Q3 earnings beat',
        confidence: 0.9,
        sources: [{ id: 'shared-src', name: 'Reuters', type: 'API', reliability: 0.9 }],
      }),
      makeSignal({
        title: 'Apple Q3 results strong',
        confidence: 0.8,
        sources: [{ id: 'shared-src', name: 'Reuters', type: 'API', reliability: 0.9 }],
      }),
    ];

    const result = deduplicateByEvent(signals);
    expect(result).toHaveLength(1);
    expect(result[0].sources).toHaveLength(1);
  });

  it('does not cluster signals with no recognized event category', () => {
    const signals = [
      makeSignal({ title: 'AAPL stock drops 5% after hours', confidence: 0.9 }),
      makeSignal({ title: 'Apple announces new product line', confidence: 0.85 }),
      makeSignal({ title: 'Tim Cook interview on CNBC', confidence: 0.7 }),
    ];

    const result = deduplicateByEvent(signals);
    expect(result).toHaveLength(3);
  });

  it('does not cluster signals from different tickers', () => {
    const signals = [
      makeSignal({
        title: 'AAPL Q3 earnings beat',
        assets: [{ ticker: 'AAPL', relevance: 0.9, linkType: 'DIRECT' }],
      }),
      makeSignal({
        title: 'MSFT Q3 earnings beat',
        assets: [{ ticker: 'MSFT', relevance: 0.9, linkType: 'DIRECT' }],
      }),
    ];

    const result = deduplicateByEvent(signals);
    expect(result).toHaveLength(2);
  });

  it('does not cluster signals from different days', () => {
    const signals = [
      makeSignal({ title: 'AAPL Q3 earnings beat', publishedAt: '2026-04-11T10:00:00.000Z' }),
      makeSignal({ title: 'Apple Q3 earnings details emerge', publishedAt: '2026-04-12T10:00:00.000Z' }),
    ];

    const result = deduplicateByEvent(signals);
    expect(result).toHaveLength(2);
  });

  it('does not cluster signals from different event categories', () => {
    const signals = [
      makeSignal({ title: 'AAPL Q3 earnings beat expectations' }), // EARNINGS
      makeSignal({ title: 'AAPL upgraded by Morgan Stanley' }), // ANALYST
    ];

    const result = deduplicateByEvent(signals);
    expect(result).toHaveLength(2);
  });

  it('prefers signals with fewer tickers (more specific)', () => {
    const specific = makeSignal({
      title: 'AAPL Q3 earnings detailed analysis',
      confidence: 0.8,
      assets: [{ ticker: 'AAPL', relevance: 0.9, linkType: 'DIRECT' }],
    });
    const roundup = makeSignal({
      title: 'Tech earnings roundup: AAPL, MSFT, GOOG beat estimates',
      confidence: 0.8,
      assets: [
        { ticker: 'AAPL', relevance: 0.7, linkType: 'DIRECT' },
        { ticker: 'MSFT', relevance: 0.7, linkType: 'DIRECT' },
        { ticker: 'GOOG', relevance: 0.7, linkType: 'DIRECT' },
      ],
    });

    // AAPL cluster contains both; specific (1 ticker) wins over roundup (3 tickers)
    const result = deduplicateByEvent([roundup, specific]);
    const aaplSignal = result.find((s) => s.assets.some((a) => a.ticker === 'AAPL'));
    expect(aaplSignal?.title).toBe('AAPL Q3 earnings detailed analysis');
  });

  it('passes through signals with no assets', () => {
    const signal = makeSignal({
      title: 'Global earnings season begins',
      assets: [],
    });

    const result = deduplicateByEvent([signal]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(signal.id);
  });

  it('handles empty input', () => {
    expect(deduplicateByEvent([])).toEqual([]);
  });

  it('handles single signal input', () => {
    const signal = makeSignal({ title: 'AAPL Q3 earnings beat' });
    const result = deduplicateByEvent([signal]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(signal.id);
  });
});
