import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RateBudgetGuard } from '../../../src/guards/security/rate-budget.js';
import type { ProposedAction } from '../../../src/guards/types.js';

const action: ProposedAction = { type: 'tool_call', toolName: 'test' };

describe('RateBudgetGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows calls within budget', () => {
    const guard = new RateBudgetGuard({ maxCallsPerMinute: 5 });

    for (let i = 0; i < 5; i++) {
      expect(guard.check(action).pass).toBe(true);
    }
  });

  it('blocks when budget exceeded', () => {
    const guard = new RateBudgetGuard({ maxCallsPerMinute: 3 });

    expect(guard.check(action).pass).toBe(true);
    expect(guard.check(action).pass).toBe(true);
    expect(guard.check(action).pass).toBe(true);

    const result = guard.check(action);
    expect(result.pass).toBe(false);
    if (!result.pass) {
      expect(result.reason).toContain('Rate limit exceeded');
    }
  });

  it('window slides — old calls expire', () => {
    const guard = new RateBudgetGuard({ maxCallsPerMinute: 2 });

    expect(guard.check(action).pass).toBe(true);
    expect(guard.check(action).pass).toBe(true);
    expect(guard.check(action).pass).toBe(false);

    // Advance time past the 1-minute window
    vi.advanceTimersByTime(61_000);

    expect(guard.check(action).pass).toBe(true);
  });

  it('reset clears the window', () => {
    const guard = new RateBudgetGuard({ maxCallsPerMinute: 1 });

    expect(guard.check(action).pass).toBe(true);
    expect(guard.check(action).pass).toBe(false);

    guard.reset();
    expect(guard.check(action).pass).toBe(true);
  });
});
