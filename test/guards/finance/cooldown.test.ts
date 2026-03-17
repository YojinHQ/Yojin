import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CooldownGuard } from '../../../src/guards/finance/cooldown.js';
import type { ProposedAction } from '../../../src/guards/types.js';

function action(symbol: string, type = 'trade'): ProposedAction {
  return { type, symbol };
}

describe('CooldownGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes when no symbol', () => {
    const guard = new CooldownGuard();
    expect(guard.check({ type: 'tool_call' }).pass).toBe(true);
  });

  it('passes first action on a symbol', () => {
    const guard = new CooldownGuard();
    expect(guard.check(action('AAPL')).pass).toBe(true);
  });

  it('blocks rapid repeat on same symbol + type', () => {
    const guard = new CooldownGuard({ minIntervalMs: 5000 });

    expect(guard.check(action('AAPL')).pass).toBe(true);

    const result = guard.check(action('AAPL'));
    expect(result.pass).toBe(false);
    if (!result.pass) {
      expect(result.reason).toContain('Cooldown');
      expect(result.reason).toContain('AAPL');
    }
  });

  it('allows after cooldown expires', () => {
    const guard = new CooldownGuard({ minIntervalMs: 5000 });

    expect(guard.check(action('AAPL')).pass).toBe(true);
    expect(guard.check(action('AAPL')).pass).toBe(false);

    vi.advanceTimersByTime(6000);
    expect(guard.check(action('AAPL')).pass).toBe(true);
  });

  it('allows different symbols within cooldown', () => {
    const guard = new CooldownGuard({ minIntervalMs: 5000 });

    expect(guard.check(action('AAPL')).pass).toBe(true);
    expect(guard.check(action('GOOG')).pass).toBe(true);
  });

  it('allows different action types on same symbol', () => {
    const guard = new CooldownGuard({ minIntervalMs: 5000 });

    expect(guard.check(action('AAPL', 'trade')).pass).toBe(true);
    expect(guard.check(action('AAPL', 'tool_call')).pass).toBe(true);
  });

  it('reset clears all cooldowns', () => {
    const guard = new CooldownGuard({ minIntervalMs: 60000 });

    expect(guard.check(action('AAPL')).pass).toBe(true);
    expect(guard.check(action('AAPL')).pass).toBe(false);

    guard.reset();
    expect(guard.check(action('AAPL')).pass).toBe(true);
  });
});
