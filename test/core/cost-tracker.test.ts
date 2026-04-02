import { describe, expect, it } from 'vitest';

import { CostTracker } from '../../src/core/cost-tracker.js';

describe('CostTracker', () => {
  it('tracks cost for a known model', () => {
    const tracker = new CostTracker();
    const cost = tracker.addUsage('claude-sonnet-4-6', {
      inputTokens: 1_000_000,
      outputTokens: 500_000,
    });

    // Sonnet: $3/Mtok input + $15/Mtok output
    // 1M * $3 + 0.5M * $15 = $3 + $7.5 = $10.5
    expect(cost).toBeCloseTo(10.5, 2);

    const snap = tracker.snapshot();
    expect(snap.totalCostUsd).toBeCloseTo(10.5, 2);
    expect(snap.totalCalls).toBe(1);
    expect(snap.totalInputTokens).toBe(1_000_000);
    expect(snap.totalOutputTokens).toBe(500_000);
  });

  it('tracks cost for opus model', () => {
    const tracker = new CostTracker();
    const cost = tracker.addUsage('claude-opus-4-6', {
      inputTokens: 100_000,
      outputTokens: 50_000,
    });

    // Opus: $15/Mtok input + $75/Mtok output
    // 0.1M * $15 + 0.05M * $75 = $1.5 + $3.75 = $5.25
    expect(cost).toBeCloseTo(5.25, 2);
  });

  it('accumulates across multiple calls', () => {
    const tracker = new CostTracker();
    tracker.addUsage('claude-sonnet-4-6', { inputTokens: 500_000, outputTokens: 100_000 });
    tracker.addUsage('claude-sonnet-4-6', { inputTokens: 500_000, outputTokens: 100_000 });

    const snap = tracker.snapshot();
    expect(snap.totalCalls).toBe(2);
    expect(snap.totalInputTokens).toBe(1_000_000);
    expect(snap.totalOutputTokens).toBe(200_000);

    // 2 * (0.5M * $3 + 0.1M * $15) = 2 * ($1.5 + $1.5) = $6
    expect(snap.totalCostUsd).toBeCloseTo(6, 2);
  });

  it('tracks multiple models separately', () => {
    const tracker = new CostTracker();
    tracker.addUsage('claude-sonnet-4-6', { inputTokens: 100_000, outputTokens: 50_000 });
    tracker.addUsage('claude-opus-4-6', { inputTokens: 100_000, outputTokens: 50_000 });

    const snap = tracker.snapshot();
    expect(snap.totalCalls).toBe(2);
    expect(snap.byModel.size).toBe(2);
    expect(snap.byModel.has('claude-sonnet-4-6')).toBe(true);
    expect(snap.byModel.has('claude-opus-4-6')).toBe(true);
  });

  it('matches gpt-4o-mini to its own pricing, not gpt-4o', () => {
    const tracker = new CostTracker();
    const cost = tracker.addUsage('gpt-4o-mini', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });

    // gpt-4o-mini: $0.15/Mtok input + $0.60/Mtok output = $0.75
    // NOT gpt-4o: $2.50 + $10 = $12.50
    expect(cost).toBeCloseTo(0.75, 2);
  });

  it('matches o1-mini to its own pricing, not o1', () => {
    const tracker = new CostTracker();
    const cost = tracker.addUsage('o1-mini', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });

    // o1-mini: $3/Mtok input + $12/Mtok output = $15
    // NOT o1: $15 + $60 = $75
    expect(cost).toBeCloseTo(15, 2);
  });

  it('uses fallback pricing for unknown models', () => {
    const tracker = new CostTracker();
    const cost = tracker.addUsage('unknown-model-v1', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });

    // Fallback: $3/Mtok input + $15/Mtok output = $18
    expect(cost).toBeCloseTo(18, 2);
  });

  it('includes cache tokens in cost', () => {
    const tracker = new CostTracker();
    const cost = tracker.addUsage('claude-sonnet-4-6', {
      inputTokens: 100_000,
      outputTokens: 50_000,
      cacheReadTokens: 200_000,
    });

    // Input: 0.1M * $3 = $0.30
    // Output: 0.05M * $15 = $0.75
    // Cache read: 0.2M * $0.30 = $0.06
    // Total: $1.11
    expect(cost).toBeCloseTo(1.11, 2);
  });

  describe('budget enforcement', () => {
    it('reports not over budget when under limit', () => {
      const tracker = new CostTracker({ maxRunBudgetUsd: 10 });
      tracker.addUsage('claude-sonnet-4-6', { inputTokens: 100_000, outputTokens: 50_000 });

      expect(tracker.isOverBudget()).toBe(false);
    });

    it('reports over budget when limit exceeded', () => {
      const tracker = new CostTracker({ maxRunBudgetUsd: 0.01 });
      tracker.addUsage('claude-sonnet-4-6', { inputTokens: 100_000, outputTokens: 50_000 });

      expect(tracker.isOverBudget()).toBe(true);
    });

    it('does not enforce budget when no limit set', () => {
      const tracker = new CostTracker();
      tracker.addUsage('claude-opus-4-6', { inputTokens: 10_000_000, outputTokens: 5_000_000 });

      expect(tracker.isOverBudget()).toBe(false);
    });
  });

  it('resets counters', () => {
    const tracker = new CostTracker();
    tracker.addUsage('claude-sonnet-4-6', { inputTokens: 100_000, outputTokens: 50_000 });
    tracker.reset();

    const snap = tracker.snapshot();
    expect(snap.totalCostUsd).toBe(0);
    expect(snap.totalCalls).toBe(0);
    expect(snap.byModel.size).toBe(0);
  });

  it('formats a readable summary', () => {
    const tracker = new CostTracker();
    tracker.addUsage('claude-sonnet-4-6', { inputTokens: 100_000, outputTokens: 50_000 });

    const summary = tracker.formatSummary();
    expect(summary).toContain('Total:');
    expect(summary).toContain('claude-sonnet-4-6');
    expect(summary).toContain('1 calls');
  });
});
