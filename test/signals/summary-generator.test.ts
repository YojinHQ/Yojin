import { describe, expect, it, vi } from 'vitest';

import { SummaryGenerator } from '../../src/signals/summary-generator.js';
import type { Signal } from '../../src/signals/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: 'sig-test-001',
    contentHash: 'abc123',
    type: 'NEWS',
    title: 'Apple reports record quarterly earnings',
    assets: [{ ticker: 'AAPL', relevance: 0.9, linkType: 'DIRECT' }],
    sources: [{ id: 'fmp', name: 'Financial Modeling Prep', type: 'API', reliability: 0.85 }],
    publishedAt: '2026-03-25T10:00:00.000Z',
    ingestedAt: '2026-03-25T10:01:00.000Z',
    confidence: 0.85,
    outputType: 'INSIGHT',
    version: 1,
    ...overrides,
  };
}

function makeLlmResponse(
  overrides: Partial<{
    tier1: string;
    tier2: string;
    sentiment: string;
    isUrgent: boolean;
  }> = {},
): string {
  return JSON.stringify({
    tier1: 'Apple hits record earnings milestone',
    tier2:
      'Apple Inc. reported record quarterly revenue beating analyst expectations. The results signal strong consumer demand for premium devices. Source: Financial Modeling Prep.',
    sentiment: 'BULLISH',
    isUrgent: false,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SummaryGenerator', () => {
  it('generates tier1, tier2, sentiment, and outputType from a valid LLM response', async () => {
    const complete = vi.fn().mockResolvedValue(makeLlmResponse());
    const generator = new SummaryGenerator({ complete });

    const result = await generator.generate(makeSignal());

    expect(result.tier1).toBe('Apple hits record earnings milestone');
    expect(result.tier2).toContain('Apple Inc.');
    expect(result.sentiment).toBe('BULLISH');
    expect(result.outputType).toBe('INSIGHT');
  });

  it('falls back to signal title when LLM call rejects', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('LLM unavailable'));
    const generator = new SummaryGenerator({ complete });

    const signal = makeSignal({ title: 'Apple reports record quarterly earnings' });
    const result = await generator.generate(signal);

    expect(result.tier1).toBe('Apple reports record quarterly earnings');
    expect(result.tier2).toBe('Apple reports record quarterly earnings');
    expect(result.sentiment).toBe('NEUTRAL');
    expect(result.outputType).toBe('INSIGHT');
  });

  it('falls back to signal title when LLM returns invalid JSON', async () => {
    const complete = vi.fn().mockResolvedValue('not valid json at all }{');
    const generator = new SummaryGenerator({ complete });

    const signal = makeSignal({ title: 'Fed raises interest rates by 50 basis points' });
    const result = await generator.generate(signal);

    expect(result.tier1).toBe('Fed raises interest rates by 50 basis points');
    expect(result.tier2).toBe('Fed raises interest rates by 50 basis points');
    expect(result.sentiment).toBe('NEUTRAL');
    expect(result.outputType).toBe('INSIGHT');
  });

  it('maps isUrgent=true to ALERT outputType', async () => {
    const complete = vi.fn().mockResolvedValue(makeLlmResponse({ isUrgent: true, sentiment: 'NEUTRAL' }));
    const generator = new SummaryGenerator({ complete });

    const result = await generator.generate(makeSignal({ confidence: 0.5 }));

    expect(result.outputType).toBe('ALERT');
  });

  it('maps BEARISH sentiment + confidence > 0.7 to ALERT', async () => {
    const complete = vi.fn().mockResolvedValue(makeLlmResponse({ sentiment: 'BEARISH', isUrgent: false }));
    const generator = new SummaryGenerator({ complete });

    const result = await generator.generate(makeSignal({ confidence: 0.8 }));

    expect(result.sentiment).toBe('BEARISH');
    expect(result.outputType).toBe('ALERT');
  });

  it('keeps BEARISH as INSIGHT when confidence is <= 0.7', async () => {
    const complete = vi.fn().mockResolvedValue(makeLlmResponse({ sentiment: 'BEARISH', isUrgent: false }));
    const generator = new SummaryGenerator({ complete });

    const result = await generator.generate(makeSignal({ confidence: 0.7 }));

    expect(result.sentiment).toBe('BEARISH');
    expect(result.outputType).toBe('INSIGHT');
  });

  it('includes multiple source names in the prompt', async () => {
    const complete = vi.fn().mockResolvedValue(makeLlmResponse());
    const generator = new SummaryGenerator({ complete });

    const signal = makeSignal({
      sources: [
        { id: 'fmp', name: 'Financial Modeling Prep', type: 'API', reliability: 0.85 },
        { id: 'reuters', name: 'Reuters', type: 'RSS', reliability: 0.9 },
        { id: 'keelson', name: 'Keelson', type: 'ENRICHMENT', reliability: 0.8 },
      ],
    });

    await generator.generate(signal);

    const prompt: string = complete.mock.calls[0][0] as string;
    expect(prompt).toContain('Financial Modeling Prep');
    expect(prompt).toContain('Reuters');
    expect(prompt).toContain('Keelson');
  });

  it('truncates title to 60 chars in tier1 fallback', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('fail'));
    const generator = new SummaryGenerator({ complete });

    const longTitle = 'A'.repeat(80);
    const result = await generator.generate(makeSignal({ title: longTitle }));

    expect(result.tier1).toHaveLength(60);
    expect(result.tier2).toBe(longTitle); // tier2 is full title, not truncated
  });
});
