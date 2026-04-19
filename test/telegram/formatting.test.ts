import { describe, expect, it } from 'vitest';

import {
  chunkMessage,
  escapeHtml,
  formatAction,
  formatInsight,
  formatSnap,
} from '../../channels/telegram/src/formatting.js';
import type { Action } from '../../src/actions/types.js';
import type { InsightReport } from '../../src/insights/types.js';
import type { Snap } from '../../src/snap/types.js';

describe('escapeHtml', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('leaves safe text unchanged', () => {
    expect(escapeHtml('Hello World 123')).toBe('Hello World 123');
  });
});

describe('chunkMessage', () => {
  it('returns single chunk for short messages', () => {
    expect(chunkMessage('Hello', 4096)).toEqual(['Hello']);
  });

  it('splits at paragraph boundaries', () => {
    const para1 = 'A'.repeat(3000);
    const para2 = 'B'.repeat(3000);
    const chunks = chunkMessage(`${para1}\n\n${para2}`, 4096);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(para1);
    expect(chunks[1]).toBe(para2);
  });

  it('splits at newline boundaries when no paragraph break fits', () => {
    const line1 = 'A'.repeat(3000);
    const line2 = 'B'.repeat(3000);
    const chunks = chunkMessage(`${line1}\n${line2}`, 4096);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(line1);
    expect(chunks[1]).toBe(line2);
  });

  it('hard-cuts when no boundary exists', () => {
    const text = 'A'.repeat(5000);
    const chunks = chunkMessage(text, 4096);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(4096);
    expect(chunks[1]).toHaveLength(904);
  });
});

describe('formatSnap', () => {
  it('formats with HTML and action items', () => {
    const snap: Snap = {
      id: 'snap-1',
      generatedAt: '2026-03-30T08:00:00Z',
      intelSummary: 'Markets are mixed. Tech rallying, energy weak.',
      actionItems: [
        { text: 'AAPL earnings beat expectations', signalIds: ['sig-1'] },
        { text: 'Oil prices declining', signalIds: [] },
        { text: 'Fed meeting minutes released', signalIds: [] },
      ],
    };

    const result = formatSnap(snap);
    expect(result).toContain('<b>Snap Brief</b>');
    expect(result).toContain('AAPL earnings beat expectations');
    expect(result).toContain('Markets are mixed');
    expect(result).toContain('<b>Summaries:</b>');
  });
});

describe('formatAction', () => {
  const baseAction: Action = {
    id: 'act-1',
    strategyId: 'momentum',
    strategyName: 'Momentum Breakout',
    triggerId: 'momentum-PRICE_MOVE-AAPL',
    triggerType: 'PRICE_MOVE',
    verdict: 'BUY',
    what: 'BUY AAPL — golden cross + expanding volume',
    why: 'RSI reclaimed 50 and the 50D crossed above the 200D',
    tickers: ['AAPL'],
    status: 'PENDING',
    expiresAt: '2026-03-31T08:00:00Z',
    createdAt: '2026-03-30T08:00:00Z',
  };

  it('bolds the full headline (action.what) as one line', () => {
    const result = formatAction(baseAction);
    expect(result).toContain('<b>BUY AAPL — golden cross + expanding volume</b>');
    expect(result).toContain('RSI reclaimed 50');
  });

  it('omits the reasoning block when it duplicates the headline', () => {
    const action: Action = { ...baseAction, why: baseAction.what };
    const result = formatAction(action);
    const occurrences = result.split('golden cross').length - 1;
    expect(occurrences).toBe(1);
  });

  it('does not prepend a verdict badge or lightning emoji', () => {
    const result = formatAction(baseAction);
    expect(result).not.toMatch(/\u26A1/);
    expect(result.startsWith('<b>BUY AAPL —')).toBe(true);
  });

  it('reconstructs verdict + ticker when action.what omits them', () => {
    const offShape: Action = { ...baseAction, what: 'golden cross + expanding volume' };
    const result = formatAction(offShape);
    expect(result.startsWith('<b>BUY AAPL — golden cross + expanding volume</b>')).toBe(true);
  });

  it('escapes HTML special characters from headlines and reasoning', () => {
    const action: Action = {
      ...baseAction,
      what: 'BUY AAPL — P&L improves <sharply>',
      why: 'Conviction & risk both <high>',
    };
    const result = formatAction(action);
    expect(result).toContain('P&amp;L improves &lt;sharply&gt;');
    expect(result).toContain('Conviction &amp; risk both &lt;high&gt;');
  });
});

describe('formatInsight', () => {
  it('formats portfolio health and positions', () => {
    const report = {
      id: 'ins-1',
      snapshotId: 'snap-1',
      positions: [
        {
          symbol: 'AAPL',
          name: 'Apple',
          rating: 'BULLISH',
          conviction: 0.8,
          thesis: 'Strong earnings',
          keySignals: [],
          allSignalIds: [],
          risks: [],
          opportunities: [],
          memoryContext: null,
          priceTarget: null,
        },
        {
          symbol: 'MSFT',
          name: 'Microsoft',
          rating: 'NEUTRAL',
          conviction: 0.5,
          thesis: 'Mixed signals',
          keySignals: [],
          allSignalIds: [],
          risks: [],
          opportunities: [],
          memoryContext: null,
          priceTarget: null,
        },
      ],
      portfolio: {
        overallHealth: 'HEALTHY',
        summary: 'Portfolio is well positioned.',
        sectorThemes: [],
        macroContext: '',
        topRisks: [],
        topOpportunities: [],
        actionItems: [],
      },
      agentOutputs: { researchAnalyst: '', riskManager: '', strategist: '' },
      emotionState: { confidence: 0.7, riskAppetite: 0.5, reason: 'Stable market' },
      createdAt: '2026-03-30T08:00:00Z',
      durationMs: 5000,
    } as InsightReport;

    const result = formatInsight(report);
    expect(result).toContain('<b>Daily Insights Report</b>');
    expect(result).toContain('HEALTHY');
    expect(result).toContain('AAPL BULLISH');
  });
});
