import { describe, expect, it } from 'vitest';

import {
  chunkMessage,
  formatAction,
  formatInsight,
  formatSnap,
  toWhatsApp,
} from '../../../channels/whatsapp/src/formatting.js';
import type { Action } from '../../../src/actions/types.js';
import type { InsightReport } from '../../../src/insights/types.js';
import type { Snap } from '../../../src/snap/types.js';

describe('toWhatsApp', () => {
  it('converts HTML <b> to WhatsApp bold', () => {
    expect(toWhatsApp('<b>hello</b>')).toBe('*hello*');
  });

  it('converts HTML <strong> to WhatsApp bold', () => {
    expect(toWhatsApp('<strong>hello</strong>')).toBe('*hello*');
  });

  it('converts HTML <i> to WhatsApp italic', () => {
    expect(toWhatsApp('<i>hello</i>')).toBe('_hello_');
  });

  it('converts HTML <em> to WhatsApp italic', () => {
    expect(toWhatsApp('<em>hello</em>')).toBe('_hello_');
  });

  it('converts HTML <s> to WhatsApp strikethrough', () => {
    expect(toWhatsApp('<s>hello</s>')).toBe('~hello~');
  });

  it('converts HTML <del> to WhatsApp strikethrough', () => {
    expect(toWhatsApp('<del>hello</del>')).toBe('~hello~');
  });

  it('converts HTML <code> to WhatsApp monospace', () => {
    expect(toWhatsApp('<code>hello</code>')).toBe('```hello```');
  });

  it('strips remaining HTML tags', () => {
    expect(toWhatsApp('<p>hello</p>')).toBe('hello');
    expect(toWhatsApp('<div class="foo">world</div>')).toBe('world');
  });

  it('decodes common HTML entities', () => {
    expect(toWhatsApp('a &amp; b')).toBe('a & b');
    expect(toWhatsApp('a &lt; b &gt; c')).toBe('a < b > c');
  });

  it('converts Markdown **bold** to WhatsApp bold', () => {
    expect(toWhatsApp('**hello**')).toBe('*hello*');
  });

  it('converts Markdown ~~strikethrough~~ to WhatsApp strikethrough', () => {
    expect(toWhatsApp('~~hello~~')).toBe('~hello~');
  });

  it('converts Markdown inline `code` to WhatsApp monospace', () => {
    expect(toWhatsApp('`hello`')).toBe('```hello```');
  });

  it('preserves WhatsApp-native _italic_ unchanged', () => {
    expect(toWhatsApp('_hello_')).toBe('_hello_');
  });

  it('preserves WhatsApp-native *bold* unchanged', () => {
    expect(toWhatsApp('*hello*')).toBe('*hello*');
  });

  it('preserves WhatsApp-native triple backtick code blocks unchanged', () => {
    expect(toWhatsApp('```hello```')).toBe('```hello```');
  });

  it('handles mixed HTML and Markdown input', () => {
    const result = toWhatsApp('<b>Title</b>: **bold** and `code`');
    expect(result).toContain('*Title*');
    expect(result).toContain('*bold*');
    expect(result).toContain('```code```');
  });

  it('handles plain text unchanged', () => {
    expect(toWhatsApp('Hello World 123')).toBe('Hello World 123');
  });

  it('handles empty string', () => {
    expect(toWhatsApp('')).toBe('');
  });
});

describe('chunkMessage', () => {
  it('returns single chunk for short messages', () => {
    expect(chunkMessage('Hello', 65536)).toEqual(['Hello']);
  });

  it('returns single chunk when message fits exactly', () => {
    const text = 'A'.repeat(65536);
    expect(chunkMessage(text, 65536)).toEqual([text]);
  });

  it('splits at paragraph boundaries (\n\n)', () => {
    const para1 = 'A'.repeat(50000);
    const para2 = 'B'.repeat(50000);
    const chunks = chunkMessage(`${para1}\n\n${para2}`, 65536);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(para1);
    expect(chunks[1]).toBe(para2);
  });

  it('splits at newline boundaries when no paragraph break fits', () => {
    const line1 = 'A'.repeat(50000);
    const line2 = 'B'.repeat(50000);
    const chunks = chunkMessage(`${line1}\n${line2}`, 65536);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(line1);
    expect(chunks[1]).toBe(line2);
  });

  it('hard-cuts when no boundary fits within limit', () => {
    const text = 'A'.repeat(70000);
    const chunks = chunkMessage(text, 65536);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(65536);
    expect(chunks[1]).toHaveLength(70000 - 65536);
  });

  it('uses default limit of 65536', () => {
    const short = 'Hello';
    expect(chunkMessage(short)).toEqual([short]);
  });
});

describe('formatSnap', () => {
  const snap: Snap = {
    id: 'snap-1',
    generatedAt: '2026-03-30T08:00:00Z',
    intelSummary: 'Markets are mixed. Tech rallying, energy weak.',
    actionItems: [
      { text: 'AAPL earnings beat expectations', signalIds: ['sig-1'] },
      { text: 'Oil prices declining', signalIds: [] },
    ],
    assetSnaps: [],
  };

  it('includes the Snap Brief header with WhatsApp bold', () => {
    const result = formatSnap(snap);
    expect(result).toContain('*Snap Brief*');
  });

  it('includes the intel summary', () => {
    const result = formatSnap(snap);
    expect(result).toContain('Markets are mixed');
  });

  it('includes action items label with WhatsApp bold', () => {
    const result = formatSnap(snap);
    expect(result).toContain('*Actions:*');
  });

  it('includes action item text', () => {
    const result = formatSnap(snap);
    expect(result).toContain('AAPL earnings beat expectations');
    expect(result).toContain('Oil prices declining');
  });

  it('handles snap with no action items', () => {
    const emptySnap: Snap = {
      id: 'snap-2',
      generatedAt: '2026-03-30T08:00:00Z',
      intelSummary: 'All quiet.',
      actionItems: [],
      assetSnaps: [],
    };
    const result = formatSnap(emptySnap);
    expect(result).toContain('All quiet.');
    expect(result).not.toContain('*Actions:*');
  });

  it('does not use HTML tags', () => {
    const result = formatSnap(snap);
    expect(result).not.toMatch(/<[a-z]+>/i);
  });
});

describe('formatAction', () => {
  const action: Action = {
    id: 'act-1',
    what: 'Review AAPL — bearish divergence detected',
    why: 'RSI divergence on daily chart',
    source: 'skill: momentum',
    status: 'PENDING',
    expiresAt: '2026-03-31T08:00:00Z',
    createdAt: '2026-03-30T08:00:00Z',
  };

  it('includes the New Action header with WhatsApp bold', () => {
    const result = formatAction(action);
    expect(result).toContain('*New Action*');
  });

  it('uses ticker as header for micro-observation actions', () => {
    const microAction = { ...action, source: 'micro-observation: AAPL' };
    const result = formatAction(microAction);
    expect(result).toContain('*AAPL*');
    expect(result).not.toContain('New Action');
  });

  it('includes the what field', () => {
    const result = formatAction(action);
    expect(result).toContain('Review AAPL');
  });

  it('does not include why or source fields', () => {
    const result = formatAction(action);
    expect(result).not.toContain('_Why:_');
    expect(result).not.toContain('_Source:_');
  });

  it('does not use HTML tags', () => {
    const result = formatAction(action);
    expect(result).not.toMatch(/<[a-z]+>/i);
  });
});

describe('formatInsight', () => {
  const report = {
    id: 'ins-1',
    snapshotId: 'snap-1',
    positions: [
      {
        symbol: 'AAPL',
        name: 'Apple',
        rating: 'BULLISH' as const,
        conviction: 0.8,
        thesis: 'Strong earnings momentum',
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
        rating: 'NEUTRAL' as const,
        conviction: 0.5,
        thesis: 'Mixed signals from cloud division',
        keySignals: [],
        allSignalIds: [],
        risks: [],
        opportunities: [],
        memoryContext: null,
        priceTarget: null,
      },
    ],
    portfolio: {
      overallHealth: 'HEALTHY' as const,
      summary: 'Portfolio is well positioned.',
      intelSummary: '',
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

  it('includes the Daily Insights Report header with WhatsApp bold', () => {
    const result = formatInsight(report);
    expect(result).toContain('*Daily Insights Report*');
  });

  it('includes portfolio health with WhatsApp bold label', () => {
    const result = formatInsight(report);
    expect(result).toContain('*Health:*');
    expect(result).toContain('HEALTHY');
  });

  it('includes compact position ratings on one line', () => {
    const result = formatInsight(report);
    expect(result).toContain('AAPL BULLISH');
    expect(result).toContain('MSFT NEUTRAL');
  });

  it('includes position symbols and ratings', () => {
    const result = formatInsight(report);
    expect(result).toContain('AAPL');
    expect(result).toContain('BULLISH');
    expect(result).toContain('MSFT');
    expect(result).toContain('NEUTRAL');
  });

  it('includes open Yojin CTA', () => {
    const result = formatInsight(report);
    expect(result).toContain('_Open Yojin for full report_');
  });

  it('includes all positions in compact format', () => {
    const manyPositions = Array.from({ length: 7 }, (_, i) => ({
      symbol: `SYM${i}`,
      name: `Company ${i}`,
      rating: 'NEUTRAL' as const,
      conviction: 0.5,
      thesis: `Thesis ${i}`,
      keySignals: [],
      allSignalIds: [],
      risks: [],
      opportunities: [],
      memoryContext: null,
      priceTarget: null,
    }));

    const bigReport = { ...report, positions: manyPositions } as InsightReport;
    const result = formatInsight(bigReport);
    expect(result).toContain('SYM0 NEUTRAL');
    expect(result).toContain('SYM6 NEUTRAL');
  });

  it('does not use HTML tags', () => {
    const result = formatInsight(report);
    expect(result).not.toMatch(/<[a-z]+>/i);
  });
});
