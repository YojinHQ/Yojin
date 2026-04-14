import { describe, expect, it } from 'vitest';

import {
  TriggerStrengthSchema,
  aggregateGroupStrength,
  computeTriggerStrength,
  pickStrongestGroup,
  ratioToStrength,
} from '../../src/strategies/trigger-strength.js';

// ---------------------------------------------------------------------------
// TriggerStrengthSchema
// ---------------------------------------------------------------------------

describe('TriggerStrengthSchema', () => {
  it('accepts valid values', () => {
    expect(TriggerStrengthSchema.parse('WEAK')).toBe('WEAK');
    expect(TriggerStrengthSchema.parse('MODERATE')).toBe('MODERATE');
    expect(TriggerStrengthSchema.parse('STRONG')).toBe('STRONG');
    expect(TriggerStrengthSchema.parse('EXTREME')).toBe('EXTREME');
  });

  it('rejects invalid values', () => {
    expect(() => TriggerStrengthSchema.parse('LOW')).toThrow();
    expect(() => TriggerStrengthSchema.parse('HIGH')).toThrow();
    expect(() => TriggerStrengthSchema.parse('')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ratioToStrength — bucket boundaries
// ---------------------------------------------------------------------------

describe('ratioToStrength', () => {
  it('returns WEAK for ratio < 0.25', () => {
    expect(ratioToStrength(0)).toBe('WEAK');
    expect(ratioToStrength(0.1)).toBe('WEAK');
    expect(ratioToStrength(0.249)).toBe('WEAK');
  });

  it('returns MODERATE at boundary 0.25', () => {
    expect(ratioToStrength(0.25)).toBe('MODERATE');
  });

  it('returns MODERATE for 0.25 <= ratio < 0.75', () => {
    expect(ratioToStrength(0.5)).toBe('MODERATE');
    expect(ratioToStrength(0.749)).toBe('MODERATE');
  });

  it('returns STRONG at boundary 0.75', () => {
    expect(ratioToStrength(0.75)).toBe('STRONG');
  });

  it('returns STRONG for 0.75 <= ratio < 1.5', () => {
    expect(ratioToStrength(1.0)).toBe('STRONG');
    expect(ratioToStrength(1.499)).toBe('STRONG');
  });

  it('returns STRONG at boundary 1.5', () => {
    expect(ratioToStrength(1.5)).toBe('STRONG');
  });

  it('returns EXTREME for ratio > 1.5', () => {
    expect(ratioToStrength(1.501)).toBe('EXTREME');
    expect(ratioToStrength(2.0)).toBe('EXTREME');
    expect(ratioToStrength(10)).toBe('EXTREME');
  });

  it('returns WEAK for NaN (not EXTREME)', () => {
    expect(ratioToStrength(NaN)).toBe('WEAK');
  });

  it('returns WEAK for Infinity', () => {
    expect(ratioToStrength(Infinity)).toBe('WEAK');
    expect(ratioToStrength(-Infinity)).toBe('WEAK');
  });
});

// ---------------------------------------------------------------------------
// computeTriggerStrength — PRICE_MOVE
// ---------------------------------------------------------------------------

describe('computeTriggerStrength — PRICE_MOVE', () => {
  it('returns WEAK when overshoot ratio < 0.25', () => {
    // change=0.11, threshold=0.10 → overshoot=(0.11-0.10)/0.10=0.1 → WEAK
    expect(computeTriggerStrength('PRICE_MOVE', { change: 0.11, threshold: 0.1 })).toBe('WEAK');
  });

  it('returns MODERATE for moderate overshoot', () => {
    // change=0.14, threshold=0.10 → overshoot=0.4 → MODERATE
    expect(computeTriggerStrength('PRICE_MOVE', { change: 0.14, threshold: 0.1 })).toBe('MODERATE');
  });

  it('returns STRONG for larger overshoot', () => {
    // change=0.20, threshold=0.10 → overshoot=1.0 → STRONG
    expect(computeTriggerStrength('PRICE_MOVE', { change: 0.2, threshold: 0.1 })).toBe('STRONG');
  });

  it('returns EXTREME for very large overshoot', () => {
    // change=0.30, threshold=0.10 → overshoot=2.0 → EXTREME
    expect(computeTriggerStrength('PRICE_MOVE', { change: 0.3, threshold: 0.1 })).toBe('EXTREME');
  });

  it('uses absolute value for negative moves', () => {
    // change=-0.20, threshold=-0.10 → |(-0.20)-(-0.10)| / |-0.10| = 0.10/0.10 = 1.0 → STRONG
    expect(computeTriggerStrength('PRICE_MOVE', { change: -0.2, threshold: -0.1 })).toBe('STRONG');
  });

  it('returns MODERATE when threshold is zero', () => {
    expect(computeTriggerStrength('PRICE_MOVE', { change: 0.05, threshold: 0 })).toBe('MODERATE');
  });

  it('defaults missing context values to 0 (zero-threshold → MODERATE)', () => {
    expect(computeTriggerStrength('PRICE_MOVE', {})).toBe('MODERATE');
  });

  it('returns MODERATE for NaN context values (not EXTREME)', () => {
    expect(computeTriggerStrength('PRICE_MOVE', { change: 'n/a', threshold: 0.1 })).toBe('MODERATE');
    expect(computeTriggerStrength('PRICE_MOVE', { change: 0.15, threshold: 'n/a' })).toBe('MODERATE');
  });
});

// ---------------------------------------------------------------------------
// computeTriggerStrength — INDICATOR_THRESHOLD
// ---------------------------------------------------------------------------

describe('computeTriggerStrength — INDICATOR_THRESHOLD', () => {
  it('returns MODERATE when crossover is truthy', () => {
    expect(computeTriggerStrength('INDICATOR_THRESHOLD', { crossover: true, value: 100, threshold: 50 })).toBe(
      'MODERATE',
    );
  });

  it('returns WEAK for small overshoot without crossover', () => {
    // value=72, threshold=70 → (72-70)/70 ≈ 0.0286 → WEAK
    expect(computeTriggerStrength('INDICATOR_THRESHOLD', { value: 72, threshold: 70 })).toBe('WEAK');
  });

  it('returns STRONG for significant overshoot', () => {
    // value=80, threshold=70 → 10/70 ≈ 0.143? No: (80-70)/70 ≈ 0.143 → WEAK
    // value=90, threshold=70 → 20/70 ≈ 0.286 → MODERATE
    // Let's use bigger overshoot: value=120, threshold=70 → 50/70 ≈ 0.714 → MODERATE...
    // value=175, threshold=70 → 105/70 = 1.5 → EXTREME
    // value=150, threshold=70 → 80/70 ≈ 1.143 → STRONG
    expect(computeTriggerStrength('INDICATOR_THRESHOLD', { value: 150, threshold: 70 })).toBe('STRONG');
  });

  it('returns MODERATE when threshold is zero', () => {
    expect(computeTriggerStrength('INDICATOR_THRESHOLD', { value: 50, threshold: 0 })).toBe('MODERATE');
  });
});

// ---------------------------------------------------------------------------
// computeTriggerStrength — METRIC_THRESHOLD (same logic as INDICATOR_THRESHOLD)
// ---------------------------------------------------------------------------

describe('computeTriggerStrength — METRIC_THRESHOLD', () => {
  it('returns MODERATE when crossover is truthy', () => {
    expect(computeTriggerStrength('METRIC_THRESHOLD', { crossover: true, value: 3.5, threshold: 3.0 })).toBe(
      'MODERATE',
    );
  });

  it('computes overshoot ratio like INDICATOR_THRESHOLD', () => {
    // value=4.5, threshold=3.0 → 1.5/3.0 = 0.5 → MODERATE
    expect(computeTriggerStrength('METRIC_THRESHOLD', { value: 4.5, threshold: 3.0 })).toBe('MODERATE');
  });

  it('returns EXTREME for large overshoot', () => {
    // value=12, threshold=3.0 → 9/3 = 3.0 → EXTREME
    expect(computeTriggerStrength('METRIC_THRESHOLD', { value: 12, threshold: 3.0 })).toBe('EXTREME');
  });

  it('returns MODERATE when threshold is zero', () => {
    expect(computeTriggerStrength('METRIC_THRESHOLD', { value: 5, threshold: 0 })).toBe('MODERATE');
  });
});

// ---------------------------------------------------------------------------
// computeTriggerStrength — CONCENTRATION_DRIFT
// ---------------------------------------------------------------------------

describe('computeTriggerStrength — CONCENTRATION_DRIFT', () => {
  it('returns WEAK for minor drift', () => {
    // weight=0.21, maxWeight=0.20 → (0.21-0.20)/0.20 = 0.05 → WEAK
    expect(computeTriggerStrength('CONCENTRATION_DRIFT', { weight: 0.21, maxWeight: 0.2 })).toBe('WEAK');
  });

  it('returns MODERATE for moderate drift', () => {
    // weight=0.26, maxWeight=0.20 → 0.06/0.20 = 0.3 → MODERATE
    expect(computeTriggerStrength('CONCENTRATION_DRIFT', { weight: 0.26, maxWeight: 0.2 })).toBe('MODERATE');
  });

  it('returns STRONG for large drift', () => {
    // weight=0.38, maxWeight=0.20 → 0.18/0.20 = 0.9 → STRONG
    expect(computeTriggerStrength('CONCENTRATION_DRIFT', { weight: 0.38, maxWeight: 0.2 })).toBe('STRONG');
  });

  it('returns EXTREME for severe drift', () => {
    // weight=0.60, maxWeight=0.20 → 0.40/0.20 = 2.0 → EXTREME
    expect(computeTriggerStrength('CONCENTRATION_DRIFT', { weight: 0.6, maxWeight: 0.2 })).toBe('EXTREME');
  });

  it('handles weight below maxWeight (defensive — uses Math.abs)', () => {
    // weight=0.10, maxWeight=0.20 → |0.10-0.20|/0.20 = 0.5 → MODERATE
    expect(computeTriggerStrength('CONCENTRATION_DRIFT', { weight: 0.1, maxWeight: 0.2 })).toBe('MODERATE');
  });

  it('returns MODERATE when maxWeight is zero', () => {
    expect(computeTriggerStrength('CONCENTRATION_DRIFT', { weight: 0.5, maxWeight: 0 })).toBe('MODERATE');
  });

  it('returns MODERATE for NaN weight', () => {
    expect(computeTriggerStrength('CONCENTRATION_DRIFT', { weight: 'n/a', maxWeight: 0.2 })).toBe('MODERATE');
  });
});

// ---------------------------------------------------------------------------
// computeTriggerStrength — ALLOCATION_DRIFT (ETF-style with toleranceBps)
// ---------------------------------------------------------------------------

describe('computeTriggerStrength — ALLOCATION_DRIFT (ETF-style)', () => {
  it('returns WEAK for small delta relative to tolerance', () => {
    // delta=0.001, toleranceBps=500 → tolerance=0.05, ratio=0.001/0.05=0.02 → WEAK
    expect(computeTriggerStrength('ALLOCATION_DRIFT', { delta: 0.001, toleranceBps: 500 })).toBe('WEAK');
  });

  it('returns MODERATE for delta around tolerance', () => {
    // delta=0.055, toleranceBps=500 → tolerance=0.05, ratio=0.055/0.05=1.1 → STRONG...
    // Let me recalculate: delta=0.03, toleranceBps=500 → 0.03/0.05=0.6 → MODERATE
    expect(computeTriggerStrength('ALLOCATION_DRIFT', { delta: 0.03, toleranceBps: 500 })).toBe('MODERATE');
  });

  it('returns STRONG when delta significantly exceeds tolerance', () => {
    // delta=0.065, toleranceBps=500 → 0.065/0.05=1.3 → STRONG
    expect(computeTriggerStrength('ALLOCATION_DRIFT', { delta: 0.065, toleranceBps: 500 })).toBe('STRONG');
  });

  it('returns EXTREME for large delta', () => {
    // delta=0.15, toleranceBps=500 → 0.15/0.05=3.0 → EXTREME
    expect(computeTriggerStrength('ALLOCATION_DRIFT', { delta: 0.15, toleranceBps: 500 })).toBe('EXTREME');
  });

  it('uses absolute value of delta', () => {
    // delta=-0.065, toleranceBps=500 → same as positive → STRONG
    expect(computeTriggerStrength('ALLOCATION_DRIFT', { delta: -0.065, toleranceBps: 500 })).toBe('STRONG');
  });

  it('returns MODERATE when toleranceBps is zero', () => {
    expect(computeTriggerStrength('ALLOCATION_DRIFT', { delta: 0.05, toleranceBps: 0 })).toBe('MODERATE');
  });
});

// ---------------------------------------------------------------------------
// computeTriggerStrength — ALLOCATION_DRIFT (strategy-level with driftThreshold)
// ---------------------------------------------------------------------------

describe('computeTriggerStrength — ALLOCATION_DRIFT (strategy-level)', () => {
  it('returns WEAK for small overshoot', () => {
    // drift=0.055, driftThreshold=0.05 → |0.055-0.05|/0.05=0.1 → WEAK
    expect(computeTriggerStrength('ALLOCATION_DRIFT', { drift: 0.055, driftThreshold: 0.05 })).toBe('WEAK');
  });

  it('returns MODERATE for moderate overshoot', () => {
    // drift=0.065, driftThreshold=0.05 → 0.015/0.05=0.3 → MODERATE
    expect(computeTriggerStrength('ALLOCATION_DRIFT', { drift: 0.065, driftThreshold: 0.05 })).toBe('MODERATE');
  });

  it('returns STRONG for large overshoot', () => {
    // drift=0.10, driftThreshold=0.05 → 0.05/0.05=1.0 → STRONG
    expect(computeTriggerStrength('ALLOCATION_DRIFT', { drift: 0.1, driftThreshold: 0.05 })).toBe('STRONG');
  });

  it('returns EXTREME for very large overshoot', () => {
    // drift=0.175, driftThreshold=0.05 → 0.125/0.05=2.5 → EXTREME
    expect(computeTriggerStrength('ALLOCATION_DRIFT', { drift: 0.175, driftThreshold: 0.05 })).toBe('EXTREME');
  });

  it('uses absolute value of drift', () => {
    // drift=-0.10, driftThreshold=0.05 → |−0.10−0.05|/0.05 = 0.05/0.05 = 1.0 → STRONG
    expect(computeTriggerStrength('ALLOCATION_DRIFT', { drift: -0.1, driftThreshold: 0.05 })).toBe('STRONG');
  });

  it('uses default driftThreshold of 0.05 when absent', () => {
    // drift=0.10, default driftThreshold=0.05 → ratio=1.0 → STRONG
    expect(computeTriggerStrength('ALLOCATION_DRIFT', { drift: 0.1 })).toBe('STRONG');
  });

  it('returns MODERATE when driftThreshold is zero', () => {
    expect(computeTriggerStrength('ALLOCATION_DRIFT', { drift: 0.05, driftThreshold: 0 })).toBe('MODERATE');
  });
});

// ---------------------------------------------------------------------------
// computeTriggerStrength — DRAWDOWN
// ---------------------------------------------------------------------------

describe('computeTriggerStrength — DRAWDOWN', () => {
  it('returns WEAK for minor drawdown overshoot', () => {
    // drawdown=-0.105, threshold=-0.10 → |(-0.105)-(-0.10)| / |-0.10| = 0.005/0.10 = 0.05 → WEAK
    expect(computeTriggerStrength('DRAWDOWN', { drawdown: -0.105, threshold: -0.1 })).toBe('WEAK');
  });

  it('returns MODERATE for moderate drawdown overshoot', () => {
    // drawdown=-0.13, threshold=-0.10 → 0.03/0.10=0.3 → MODERATE
    expect(computeTriggerStrength('DRAWDOWN', { drawdown: -0.13, threshold: -0.1 })).toBe('MODERATE');
  });

  it('returns STRONG for large drawdown overshoot', () => {
    // drawdown=-0.20, threshold=-0.10 → 0.10/0.10=1.0 → STRONG
    expect(computeTriggerStrength('DRAWDOWN', { drawdown: -0.2, threshold: -0.1 })).toBe('STRONG');
  });

  it('returns EXTREME for severe drawdown', () => {
    // drawdown=-0.35, threshold=-0.10 → 0.25/0.10=2.5 → EXTREME
    expect(computeTriggerStrength('DRAWDOWN', { drawdown: -0.35, threshold: -0.1 })).toBe('EXTREME');
  });

  it('returns MODERATE when threshold is zero', () => {
    expect(computeTriggerStrength('DRAWDOWN', { drawdown: -0.15, threshold: 0 })).toBe('MODERATE');
  });
});

// ---------------------------------------------------------------------------
// computeTriggerStrength — EARNINGS_PROXIMITY
// ---------------------------------------------------------------------------

describe('computeTriggerStrength — EARNINGS_PROXIMITY', () => {
  it('returns WEAK when earnings are far away', () => {
    // daysLeft=6, withinDays=7 → ratio=1-6/7≈0.143 → WEAK
    expect(computeTriggerStrength('EARNINGS_PROXIMITY', { daysUntilEarnings: 6, withinDays: 7 })).toBe('WEAK');
  });

  it('returns MODERATE for earnings in the middle of the window', () => {
    // daysLeft=4, withinDays=7 → ratio=1-4/7≈0.429 → MODERATE
    expect(computeTriggerStrength('EARNINGS_PROXIMITY', { daysUntilEarnings: 4, withinDays: 7 })).toBe('MODERATE');
  });

  it('returns STRONG when earnings are imminent', () => {
    // daysLeft=1, withinDays=7 → ratio=1-1/7≈0.857 → STRONG
    expect(computeTriggerStrength('EARNINGS_PROXIMITY', { daysUntilEarnings: 1, withinDays: 7 })).toBe('STRONG');
  });

  it('returns STRONG when earnings are today (ratio capped at 1.0)', () => {
    // daysLeft=0, withinDays=7 → ratio=1.0 → STRONG (EARNINGS_PROXIMITY can never reach EXTREME)
    expect(computeTriggerStrength('EARNINGS_PROXIMITY', { daysUntilEarnings: 0, withinDays: 7 })).toBe('STRONG');
  });

  it('returns WEAK when daysLeft exceeds withinDays (defensive — clamped to 0)', () => {
    // daysLeft=10, withinDays=7 → ratio=max(0, 1-10/7) = 0 → WEAK
    expect(computeTriggerStrength('EARNINGS_PROXIMITY', { daysUntilEarnings: 10, withinDays: 7 })).toBe('WEAK');
  });

  it('returns MODERATE when withinDays is zero', () => {
    expect(computeTriggerStrength('EARNINGS_PROXIMITY', { daysUntilEarnings: 0, withinDays: 0 })).toBe('MODERATE');
  });

  it('returns MODERATE for NaN daysUntilEarnings', () => {
    expect(computeTriggerStrength('EARNINGS_PROXIMITY', { daysUntilEarnings: 'soon', withinDays: 7 })).toBe('MODERATE');
  });
});

// ---------------------------------------------------------------------------
// computeTriggerStrength — SIGNAL_PRESENT and PERSON_ACTIVITY
// ---------------------------------------------------------------------------

describe('computeTriggerStrength — SIGNAL_PRESENT', () => {
  it('always returns STRONG', () => {
    expect(computeTriggerStrength('SIGNAL_PRESENT', {})).toBe('STRONG');
    expect(computeTriggerStrength('SIGNAL_PRESENT', { type: 'NEWS', sentiment: 'BULLISH' })).toBe('STRONG');
  });
});

describe('computeTriggerStrength — PERSON_ACTIVITY', () => {
  it('always returns STRONG', () => {
    expect(computeTriggerStrength('PERSON_ACTIVITY', {})).toBe('STRONG');
    expect(computeTriggerStrength('PERSON_ACTIVITY', { person: 'Warren Buffett', action: 'BUY' })).toBe('STRONG');
  });
});

// ---------------------------------------------------------------------------
// computeTriggerStrength — CUSTOM and unknown types
// ---------------------------------------------------------------------------

describe('computeTriggerStrength — CUSTOM and unknown types', () => {
  it('returns MODERATE for CUSTOM trigger', () => {
    expect(computeTriggerStrength('CUSTOM', { expression: 'some custom logic' })).toBe('MODERATE');
  });

  it('returns MODERATE for unknown trigger type strings', () => {
    expect(computeTriggerStrength('UNKNOWN_TRIGGER', {})).toBe('MODERATE');
    expect(computeTriggerStrength('some-random-type', { value: 999 })).toBe('MODERATE');
  });
});

// ---------------------------------------------------------------------------
// aggregateGroupStrength
// ---------------------------------------------------------------------------

describe('aggregateGroupStrength', () => {
  it('returns MODERATE for empty array', () => {
    expect(aggregateGroupStrength([])).toBe('MODERATE');
  });

  it('returns the single element for a one-element array', () => {
    expect(aggregateGroupStrength(['WEAK'])).toBe('WEAK');
    expect(aggregateGroupStrength(['EXTREME'])).toBe('EXTREME');
  });

  it('returns the weakest when all are different', () => {
    expect(aggregateGroupStrength(['WEAK', 'MODERATE', 'STRONG', 'EXTREME'])).toBe('WEAK');
    expect(aggregateGroupStrength(['MODERATE', 'STRONG', 'EXTREME'])).toBe('MODERATE');
    expect(aggregateGroupStrength(['STRONG', 'EXTREME'])).toBe('STRONG');
  });

  it('returns EXTREME when all are EXTREME', () => {
    expect(aggregateGroupStrength(['EXTREME', 'EXTREME', 'EXTREME'])).toBe('EXTREME');
  });

  it('returns the weakest regardless of order', () => {
    expect(aggregateGroupStrength(['EXTREME', 'WEAK', 'STRONG'])).toBe('WEAK');
    expect(aggregateGroupStrength(['STRONG', 'EXTREME', 'MODERATE'])).toBe('MODERATE');
  });
});

// ---------------------------------------------------------------------------
// pickStrongestGroup
// ---------------------------------------------------------------------------

describe('pickStrongestGroup', () => {
  it('returns undefined for empty array', () => {
    expect(pickStrongestGroup([])).toBeUndefined();
  });

  it('returns the single element for a one-element array', () => {
    const item = { triggerStrength: 'WEAK' as const, id: 1 };
    expect(pickStrongestGroup([item])).toBe(item);
  });

  it('picks the element with the strongest triggerStrength', () => {
    const a = { triggerStrength: 'WEAK' as const, id: 'a' };
    const b = { triggerStrength: 'EXTREME' as const, id: 'b' };
    const c = { triggerStrength: 'MODERATE' as const, id: 'c' };
    expect(pickStrongestGroup([a, b, c])).toBe(b);
  });

  it('returns the first element when there is a tie', () => {
    const a = { triggerStrength: 'STRONG' as const, id: 'a' };
    const b = { triggerStrength: 'STRONG' as const, id: 'b' };
    expect(pickStrongestGroup([a, b])).toBe(a);
  });

  it('handles all MODERATE correctly', () => {
    const a = { triggerStrength: 'MODERATE' as const, id: 'a' };
    const b = { triggerStrength: 'MODERATE' as const, id: 'b' };
    const c = { triggerStrength: 'MODERATE' as const, id: 'c' };
    expect(pickStrongestGroup([a, b, c])).toBe(a);
  });

  it('picks EXTREME over all others', () => {
    const items = [
      { triggerStrength: 'WEAK' as const },
      { triggerStrength: 'MODERATE' as const },
      { triggerStrength: 'STRONG' as const },
      { triggerStrength: 'EXTREME' as const },
    ];
    expect(pickStrongestGroup(items)).toBe(items[3]);
  });
});
