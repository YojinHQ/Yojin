import { describe, expect, it } from 'vitest';

import { BANNED_SIGNAL_WORDS, containsBannedLanguage, isTautologicalTier2 } from '../../src/signals/signal-language.js';

// ---------------------------------------------------------------------------
// Rule 1 — Banned language detection
// ---------------------------------------------------------------------------

describe('containsBannedLanguage', () => {
  it('returns null for clean factual copy', () => {
    expect(containsBannedLanguage('LITE traded at $654.79, down 6.8% on the session.')).toBeNull();
    expect(containsBannedLanguage('AAPL reported $1.52 EPS, beating estimates by $0.04.')).toBeNull();
    expect(containsBannedLanguage('BTC at $64,200, up 2.3% over 24h on spot ETF inflows.')).toBeNull();
  });

  it('detects single banned words', () => {
    expect(containsBannedLanguage('LITE sharply declined 6.8%')).toBe('sharply');
    expect(containsBannedLanguage('BTC surged past $65,000')).toBe('surged');
    expect(containsBannedLanguage('The stock plunged after earnings')).toBe('plunged');
    expect(containsBannedLanguage('Markets soared on Fed news')).toBe('soared');
    expect(containsBannedLanguage('Shares tumbled in after-hours')).toBe('tumbled');
    expect(containsBannedLanguage('Price spiked on volume')).toBe('spiked');
    expect(containsBannedLanguage('The index cratered overnight')).toBe('cratered');
    expect(containsBannedLanguage('Crypto tanked after hack')).toBe('tanked');
    expect(containsBannedLanguage('Stock rocketed on approval')).toBe('rocketed');
    expect(containsBannedLanguage('Shares skyrocketed after merger')).toBe('skyrocketed');
    expect(containsBannedLanguage('AAPL fell 3% on earnings')).toBe('fell');
    expect(containsBannedLanguage('Markets rallied on CPI data')).toBe('rallied');
  });

  it('detects banned multi-word phrases', () => {
    expect(containsBannedLanguage('showing strong bearish momentum in the session')).toBe('strong bearish momentum');
    expect(containsBannedLanguage('a significant decline from the previous close')).toBe('significant decline');
    expect(containsBannedLanguage('a massive drop in after-hours trading')).toBe('massive drop');
    expect(containsBannedLanguage('This was a major move for the index')).toBe('major move');
  });

  it('detects banned adjectives used as editorializing', () => {
    expect(containsBannedLanguage('a dramatic reversal in sentiment')).toBe('dramatic');
    expect(containsBannedLanguage('alarming weakness in guidance')).toBe('alarming');
    expect(containsBannedLanguage('impressive earnings beat')).toBe('impressive');
    expect(containsBannedLanguage('remarkable recovery from lows')).toBe('remarkable');
  });

  it('is case-insensitive', () => {
    expect(containsBannedLanguage('LITE SHARPLY declined')).toBe('SHARPLY');
    expect(containsBannedLanguage('Markets SURGED today')).toBe('SURGED');
    expect(containsBannedLanguage('A Dramatic reversal')).toBe('Dramatic');
  });

  it('does not false-positive on word boundaries', () => {
    // "fell" should not match "fellow" or "fella"
    expect(containsBannedLanguage('The CEO is a good fellow')).toBeNull();
    // "spiked" should not match inside other words
    expect(containsBannedLanguage('unspiked punch at the party')).toBeNull();
  });

  it('covers every entry in BANNED_SIGNAL_WORDS', () => {
    // Ensure the list is non-empty and every word is actually detected
    expect(BANNED_SIGNAL_WORDS.length).toBeGreaterThan(0);
    for (const word of BANNED_SIGNAL_WORDS) {
      const testSentence = `The stock ${word} today.`;
      const result = containsBannedLanguage(testSentence);
      expect(result, `Expected to detect banned word: "${word}"`).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — Tautological tier2 detection
// ---------------------------------------------------------------------------

describe('isTautologicalTier2', () => {
  it('returns false for factual copy with non-obvious context', () => {
    expect(
      isTautologicalTier2('LITE down 6.8% on 3x average volume following supplier warning from TSMC earnings call.'),
    ).toBe(false);

    expect(
      isTautologicalTier2(
        'AAPL traded at $178.50, down 1.2% after EU announced new digital markets investigation. Source: Reuters.',
      ),
    ).toBe(false);

    expect(
      isTautologicalTier2('BTC at $64,200, up 2.3% as spot ETF daily inflows hit $890M, highest since January.'),
    ).toBe(false);
  });

  it('flags price drop + "suggesting selling pressure"', () => {
    expect(isTautologicalTier2('LITE dropped 6.8%, suggesting selling pressure in the session.')).toBe(true);
  });

  it('flags price drop + "indicating bearish sentiment"', () => {
    expect(isTautologicalTier2('AAPL declined 3.2%, indicating bearish sentiment among traders.')).toBe(true);
  });

  it('flags price drop + "signals further decline"', () => {
    expect(isTautologicalTier2('MP Materials down 4.5%, signalling further decline ahead.')).toBe(true);
  });

  it('flags price gain + "suggesting buying interest"', () => {
    expect(isTautologicalTier2('NVDA gained 5.2%, suggesting buying interest from institutions.')).toBe(true);
  });

  it('flags price gain + "indicating bullish momentum"', () => {
    expect(isTautologicalTier2('BTC rose 8%, indicating bullish momentum in the crypto market.')).toBe(true);
  });

  it('flags price gain + "points to further upside"', () => {
    expect(isTautologicalTier2('TSLA up 3.1%, pointing to further upside potential.')).toBe(true);
  });

  it('flags "bearish/bullish momentum" followed by obvious restatement', () => {
    expect(isTautologicalTier2('The stock shows bearish momentum, suggesting further decline in the session.')).toBe(
      true,
    );
    expect(isTautologicalTier2('Strong bullish momentum indicating buying interest from retail traders.')).toBe(true);
  });

  it('does not flag standalone "bearish/bullish momentum" without restatement', () => {
    expect(isTautologicalTier2('The stock shows bearish momentum after the earnings miss.')).toBe(false);
    expect(isTautologicalTier2('Strong bullish momentum continues into the close.')).toBe(false);
  });

  it('does not flag "bearish/bullish momentum" with supporting evidence', () => {
    expect(isTautologicalTier2('bearish momentum confirmed by 4x average volume and 18 analyst downgrades')).toBe(
      false,
    );
  });

  it('does not flag when conclusion cites evidence', () => {
    // These contain actual non-obvious context, even though they use directional language
    expect(
      isTautologicalTier2(
        'AAPL down 2.1% on 4x average volume after Foxconn reported production delays. Options put/call ratio at 2.3x.',
      ),
    ).toBe(false);

    expect(
      isTautologicalTier2('Gold up 1.8% as 10Y yield dropped 12bps to 4.15% following weaker-than-expected jobs data.'),
    ).toBe(false);
  });
});
