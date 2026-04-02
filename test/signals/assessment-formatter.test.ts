import { describe, expect, it } from 'vitest';

import {
  type TickerPosition,
  type TickerThesis,
  formatSignalsForAssessment,
} from '../../src/signals/curation/assessment-formatter.js';
import type { Signal } from '../../src/signals/types.js';

function makeSignal(ticker: string, overrides: Partial<Signal> = {}): Signal {
  return {
    id: 'sig-001',
    contentHash: 'hash-001',
    type: 'NEWS',
    title: 'Apple Q4 earnings beat expectations',
    assets: [{ ticker, relevance: 0.9, linkType: 'DIRECT' }],
    sources: [{ id: 'reuters', name: 'Reuters', type: 'RSS', reliability: 0.8 }],
    publishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
    ingestedAt: new Date().toISOString(),
    confidence: 0.85,
    outputType: 'INSIGHT',
    version: 1,
    ...overrides,
  };
}

describe('formatSignalsForAssessment', () => {
  it('formats signals grouped by ticker', () => {
    const signalsByTicker = new Map<string, Signal[]>([
      ['AAPL', [makeSignal('AAPL', { id: 'sig-1' }), makeSignal('AAPL', { id: 'sig-2' })]],
    ]);

    const result = formatSignalsForAssessment(signalsByTicker, new Map(), new Map());

    expect(result).toContain('## AAPL (2 signals)');
    expect(result).toContain('[sig-1]');
    expect(result).toContain('[sig-2]');
    expect(result).toContain('NEWS');
    expect(result).toContain('conf:0.85');
  });

  it('includes thesis context when available', () => {
    const signalsByTicker = new Map([['AAPL', [makeSignal('AAPL')]]]);
    const thesisByTicker = new Map<string, TickerThesis>([
      ['AAPL', { rating: 'BULLISH', conviction: 0.8, thesis: 'Strong AI narrative' }],
    ]);

    const result = formatSignalsForAssessment(signalsByTicker, thesisByTicker, new Map());

    expect(result).toContain('THESIS: BULLISH conviction:0.8 — Strong AI narrative');
  });

  it('includes position sizing context', () => {
    const signalsByTicker = new Map([['AAPL', [makeSignal('AAPL')]]]);
    const positionsByTicker = new Map<string, TickerPosition>([
      ['AAPL', { marketValue: 18000, portfolioPercent: 0.12 }],
    ]);

    const result = formatSignalsForAssessment(signalsByTicker, new Map(), positionsByTicker);

    expect(result).toContain('position: $18K / 12%');
  });

  it('formats multiple tickers as separate sections', () => {
    const signalsByTicker = new Map([
      ['AAPL', [makeSignal('AAPL', { id: 'sig-a' })]],
      ['MSFT', [makeSignal('MSFT', { id: 'sig-b' })]],
    ]);

    const result = formatSignalsForAssessment(signalsByTicker, new Map(), new Map());

    expect(result).toContain('## AAPL');
    expect(result).toContain('## MSFT');
  });

  it('includes sentiment when available', () => {
    const signalsByTicker = new Map([['AAPL', [makeSignal('AAPL', { id: 'sig-1', sentiment: 'BULLISH' })]]]);

    const result = formatSignalsForAssessment(signalsByTicker, new Map(), new Map());

    expect(result).toContain('BULLISH');
  });

  it('includes groupId for clustered signals', () => {
    const signalsByTicker = new Map([['AAPL', [makeSignal('AAPL', { id: 'sig-1', groupId: 'grp-abc' })]]]);

    const result = formatSignalsForAssessment(signalsByTicker, new Map(), new Map());

    expect(result).toContain('group:grp-abc');
  });

  it('is more compact than raw JSON', () => {
    const signals = Array.from({ length: 10 }, (_, i) =>
      makeSignal('AAPL', { id: `sig-${i}`, title: `Signal number ${i} about AAPL` }),
    );
    const signalsByTicker = new Map([['AAPL', signals]]);

    const formatted = formatSignalsForAssessment(signalsByTicker, new Map(), new Map());
    const rawJson = JSON.stringify(signals);

    // Formatted should be significantly smaller than raw JSON
    expect(formatted.length).toBeLessThan(rawJson.length * 0.5);
  });

  it('truncates long titles', () => {
    const longTitle = 'A'.repeat(120);
    const signalsByTicker = new Map([['AAPL', [makeSignal('AAPL', { id: 'sig-1', title: longTitle })]]]);

    const result = formatSignalsForAssessment(signalsByTicker, new Map(), new Map());

    // Title should be truncated to ~80 chars
    expect(result).not.toContain(longTitle);
    expect(result).toContain('…');
  });
});
