/**
 * Micro severity helper tests — the scoring function that gates whether
 * a micro observation should be promoted to an Action.
 */

import { describe, expect, it } from 'vitest';

import { computeMicroActionSeverity, microActionSource } from '../../src/actions/micro-severity.js';

describe('computeMicroActionSeverity', () => {
  describe('LLM-emitted severity (primary path)', () => {
    it('returns the LLM severity field when present', () => {
      const score = computeMicroActionSeverity({ rating: 'BULLISH', conviction: 0.5, severity: 0.92 });
      expect(score).toBeCloseTo(0.92, 5);
    });

    it('trusts LLM severity even when it disagrees with rating/conviction', () => {
      // A VERY_BEARISH rating on a low-severity event (e.g. tiny, already-priced-in headline)
      // — we want the LLM's call, not the rating-derived 1.0 ceiling.
      const score = computeMicroActionSeverity({ rating: 'VERY_BEARISH', conviction: 0.9, severity: 0.2 });
      expect(score).toBeCloseTo(0.2, 5);
    });

    it('clamps LLM severity to [0, 1] defensively', () => {
      // Zod validates the field on the schema, but the helper is defensive in case
      // a caller bypasses it with a raw object.
      expect(computeMicroActionSeverity({ rating: 'NEUTRAL', conviction: 0.5, severity: 1.5 })).toBe(1);
      expect(computeMicroActionSeverity({ rating: 'NEUTRAL', conviction: 0.5, severity: -0.2 })).toBe(0);
    });
  });

  describe('derived fallback (legacy insights without severity)', () => {
    it('scores VERY_BULLISH at full multiplier', () => {
      const score = computeMicroActionSeverity({ rating: 'VERY_BULLISH', conviction: 0.9 });
      expect(score).toBeCloseTo(0.9, 5);
    });

    it('scores VERY_BEARISH at full multiplier', () => {
      const score = computeMicroActionSeverity({ rating: 'VERY_BEARISH', conviction: 0.5 });
      expect(score).toBeCloseTo(0.5, 5);
    });

    it('damps NEUTRAL so a high-conviction neutral does not outrank a directional call', () => {
      const neutral = computeMicroActionSeverity({ rating: 'NEUTRAL', conviction: 0.9 });
      const bearish = computeMicroActionSeverity({ rating: 'BEARISH', conviction: 0.7 });
      expect(bearish).toBeGreaterThan(neutral);
    });

    it('clamps the fallback output to [0, 1]', () => {
      const high = computeMicroActionSeverity({ rating: 'VERY_BULLISH', conviction: 1 });
      const low = computeMicroActionSeverity({ rating: 'NEUTRAL', conviction: 0 });
      expect(high).toBeLessThanOrEqual(1);
      expect(low).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('microActionSource', () => {
  it('uppercases the ticker', () => {
    expect(microActionSource('aapl')).toBe('micro-observation: AAPL');
  });
});
