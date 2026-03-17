/**
 * CooldownGuard — enforces minimum time between same-type actions on same instrument.
 */

import type { Guard, GuardResult, ProposedAction } from '../types.js';

export interface CooldownGuardOptions {
  /** Minimum interval in milliseconds (default: 5 minutes). */
  minIntervalMs?: number;
}

export class CooldownGuard implements Guard {
  readonly name = 'cooldown';
  private readonly minIntervalMs: number;
  private readonly lastAction = new Map<string, number>();

  constructor(options?: CooldownGuardOptions) {
    this.minIntervalMs = options?.minIntervalMs ?? 5 * 60 * 1000;
  }

  check(action: ProposedAction): GuardResult {
    if (!action.symbol) return { pass: true };

    const key = `${action.symbol}:${action.type}`;
    const now = Date.now();
    const last = this.lastAction.get(key);

    if (last !== undefined) {
      const elapsed = now - last;
      if (elapsed < this.minIntervalMs) {
        const remaining = Math.ceil((this.minIntervalMs - elapsed) / 1000);
        return {
          pass: false,
          reason: `Cooldown: ${action.symbol} ${action.type} — ${remaining}s remaining`,
        };
      }
    }

    this.lastAction.set(key, now);
    return { pass: true };
  }

  /** Reset all cooldowns (for testing). */
  reset(): void {
    this.lastAction.clear();
  }
}
