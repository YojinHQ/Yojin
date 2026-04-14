import { describe, expect, it } from 'vitest';

import { formatTriggerContext } from '../../src/strategies/format-trigger-context.js';

describe('formatTriggerContext', () => {
  it('pairs value/threshold/previous as percent when threshold is fractional', () => {
    const parts = formatTriggerContext({
      value: 4.5,
      threshold: 0.2,
      previous: 0.18,
    });
    expect(parts).toEqual(['value: 450.0%', 'threshold: 20.0%', 'previous: 18.0%']);
  });

  it('pairs value/threshold/previous as absolute when threshold is not fractional', () => {
    const parts = formatTriggerContext({
      value: 72.5,
      threshold: 70,
      previous: 65,
    });
    expect(parts).toEqual(['value: 72.50', 'threshold: 70.00', 'previous: 65.00']);
  });

  it('formats always-fractional keys as percent regardless of threshold', () => {
    const parts = formatTriggerContext({
      drift: 0.05,
      weight: 0.25,
    });
    expect(parts).toContain('drift: 5.0%');
    expect(parts).toContain('weight: 25.0%');
  });

  it('skips ticker field', () => {
    const parts = formatTriggerContext({ ticker: 'AAPL', value: 0.1, threshold: 0.2 });
    expect(parts.some((p) => p.startsWith('ticker'))).toBe(false);
  });

  it('humanizes camelCase keys', () => {
    const parts = formatTriggerContext({ driftThreshold: 0.1 });
    expect(parts).toEqual(['drift Threshold: 10.0%']);
  });

  it('passes through non-numeric values', () => {
    const parts = formatTriggerContext({ direction: 'above', value: 0.5, threshold: 0.2 });
    expect(parts).toContain('direction: above');
  });
});
