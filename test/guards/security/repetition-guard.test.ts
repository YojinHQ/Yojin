import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RepetitionGuard } from '../../../src/guards/security/repetition-guard.js';
import type { ProposedAction } from '../../../src/guards/types.js';

function action(toolName: string, input?: unknown): ProposedAction {
  return { type: 'tool_call', toolName, input };
}

describe('RepetitionGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes when no toolName', () => {
    const guard = new RepetitionGuard();
    expect(guard.check({ type: 'tool_call' }).pass).toBe(true);
  });

  it('allows different tool calls', () => {
    const guard = new RepetitionGuard({ maxIdenticalCalls: 2 });

    expect(guard.check(action('tool-a', { symbol: 'AAPL' })).pass).toBe(true);
    expect(guard.check(action('tool-b', { symbol: 'AAPL' })).pass).toBe(true);
    expect(guard.check(action('tool-a', { symbol: 'GOOG' })).pass).toBe(true);
  });

  it('allows same tool with different input', () => {
    const guard = new RepetitionGuard({ maxIdenticalCalls: 2 });

    expect(guard.check(action('lookup', { symbol: 'AAPL' })).pass).toBe(true);
    expect(guard.check(action('lookup', { symbol: 'GOOG' })).pass).toBe(true);
    expect(guard.check(action('lookup', { symbol: 'MSFT' })).pass).toBe(true);
  });

  it('blocks exact duplicate calls', () => {
    const guard = new RepetitionGuard({ maxIdenticalCalls: 2 });
    const a = action('lookup', { symbol: 'AAPL' });

    expect(guard.check(a).pass).toBe(true);
    expect(guard.check(a).pass).toBe(true);

    const result = guard.check(a);
    expect(result.pass).toBe(false);
    if (!result.pass) {
      expect(result.reason).toContain('Repetition blocked');
    }
  });

  it('window expires — old duplicates forgotten', () => {
    const guard = new RepetitionGuard({ maxIdenticalCalls: 2, windowMs: 10_000 });
    const a = action('lookup', { symbol: 'AAPL' });

    expect(guard.check(a).pass).toBe(true);
    expect(guard.check(a).pass).toBe(true);
    expect(guard.check(a).pass).toBe(false);

    vi.advanceTimersByTime(11_000);

    expect(guard.check(a).pass).toBe(true);
  });

  it('reset clears all tracking', () => {
    const guard = new RepetitionGuard({ maxIdenticalCalls: 1 });
    const a = action('lookup', { symbol: 'AAPL' });

    expect(guard.check(a).pass).toBe(true);
    expect(guard.check(a).pass).toBe(false);

    guard.reset();
    expect(guard.check(a).pass).toBe(true);
  });
});
