/**
 * Helpers on `src/summaries/types.ts` — `extractLead` and `hasSubstance`.
 *
 * These are the quality gate for Summary.what strings. `extractLead` keeps
 * the narrative lead of a thesis (not just the first sentence), and
 * `hasSubstance` blocks bare-indicator strings like "MFI 75." from reaching
 * the Intel Feed. Regression guard for the "MFI 75." ICVT issue.
 */

import { describe, expect, it } from 'vitest';

import { extractLead, hasSubstance } from '../../src/summaries/types.js';

describe('extractLead', () => {
  it('returns the full text when within maxLen', () => {
    expect(extractLead('AAPL supply chain risk. Guidance unclear.')).toBe('AAPL supply chain risk. Guidance unclear.');
  });

  it('collapses whitespace in the middle of the text', () => {
    expect(extractLead('one   two\n\nthree')).toBe('one two three');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(extractLead('   \n  ')).toBe('');
  });

  it('trims on a word boundary and appends an ellipsis', () => {
    // 50-char budget; the text crosses the boundary — cut at word.
    const text = 'the quick brown fox jumps over the lazy dog and then stops running suddenly';
    const result = extractLead(text, 50);
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result.endsWith('…')).toBe(true);
    // Every whole word in the result must be a prefix of the source words —
    // i.e. we never cut a word mid-letter.
    const sourceWords = new Set(text.split(/\s+/));
    const resultWords = result.replace(/…$/, '').trim().split(/\s+/);
    for (const word of resultWords) {
      expect(sourceWords.has(word)).toBe(true);
    }
  });

  it('falls back to a hard cut when no space is near the end', () => {
    // Single very long run of non-space characters — no word boundary to
    // snap to, so we fall through to the truncated+ellipsis path.
    const long = 'x'.repeat(100);
    const result = extractLead(long, 30);
    expect(result.length).toBeLessThanOrEqual(30);
    expect(result.endsWith('…')).toBe(true);
  });
});

describe('hasSubstance', () => {
  it('rejects a bare indicator reading ("MFI 75.")', () => {
    expect(hasSubstance('MFI 75.')).toBe(false);
  });

  it('rejects other bare indicators ("RSI 80", "Price 108")', () => {
    expect(hasSubstance('RSI 80')).toBe(false);
    expect(hasSubstance('Price 108')).toBe(false);
  });

  it('accepts a short but meaningful observation', () => {
    expect(hasSubstance('Gap up, no catalyst')).toBe(true);
    expect(hasSubstance('Convertible bond inflows')).toBe(true);
  });

  it('accepts a ticker plus a word (ticker counts as an alpha run)', () => {
    expect(hasSubstance('AAPL thesis')).toBe(true);
  });

  it('rejects numbers-only or empty strings', () => {
    expect(hasSubstance('')).toBe(false);
    expect(hasSubstance('80 75 108')).toBe(false);
  });

  it('rejects "nothing to report" summaries', () => {
    expect(
      hasSubstance(
        'No ETH-specific fundamental developments (protocol news, regulatory filings, major institutional actions) are present in the current dataset; recent news is unrelated macro/political content',
      ),
    ).toBe(false);
    expect(hasSubstance('No specific developments or catalysts were identified for this asset')).toBe(false);
    expect(hasSubstance('No material news or events are available for AAPL this period')).toBe(false);
    expect(hasSubstance('No notable catalysts found in the current dataset')).toBe(false);
    expect(hasSubstance('recent news is unrelated to this ticker')).toBe(false);
    expect(hasSubstance('Nothing material to report for this position')).toBe(false);
    expect(hasSubstance('No significant updates are present for BTC')).toBe(false);
  });

  it('accepts real summaries that happen to mention "no" in a different context', () => {
    expect(hasSubstance('Truist cuts AAPL PT to $323 with no upside catalyst cited')).toBe(true);
    expect(hasSubstance('Bitcoin ETF sees no outflows for fifth consecutive day')).toBe(true);
    expect(hasSubstance('Company reports no layoffs despite industry trend')).toBe(true);
  });
});
