/**
 * RateBudgetGuard — caps tool calls per minute via sliding window.
 */

import type { Guard, GuardResult, ProposedAction } from '../types.js';

export interface RateBudgetOptions {
  maxCallsPerMinute: number;
}

export class RateBudgetGuard implements Guard {
  readonly name = 'rate-budget';
  private maxCalls: number;
  private readonly timestamps: number[] = [];

  constructor(options: RateBudgetOptions) {
    this.maxCalls = options.maxCallsPerMinute;
  }

  /** Update the rate limit (called by GuardRunner on posture change). */
  setMaxCalls(maxCallsPerMinute: number): void {
    this.maxCalls = maxCallsPerMinute;
  }

  check(_action: ProposedAction): GuardResult {
    const now = Date.now();
    const windowStart = now - 60_000;

    // Purge old entries
    while (this.timestamps.length > 0 && this.timestamps[0] < windowStart) {
      this.timestamps.shift();
    }

    if (this.timestamps.length >= this.maxCalls) {
      return {
        pass: false,
        reason: `Rate limit exceeded: ${this.timestamps.length}/${this.maxCalls} calls per minute`,
      };
    }

    this.timestamps.push(now);
    return { pass: true };
  }

  /** Reset the sliding window (for testing). */
  reset(): void {
    this.timestamps.length = 0;
  }
}
