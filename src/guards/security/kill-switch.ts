/**
 * KillSwitch — emergency halt for the guard pipeline.
 *
 * When tripped, ALL actions are denied until manually reset.
 * Triggered by:
 *   - Environment variable YOJIN_KILL_SWITCH=1
 *   - Sentinel file existence (e.g. .kill in data root ~/.yojin/)
 *   - Programmatic trip via trip()
 *
 * Always runs first in the pipeline.
 */

import { existsSync } from 'node:fs';

import { resolveDataRoot } from '../../paths.js';
import type { Guard, GuardResult, ProposedAction } from '../types.js';

export interface KillSwitchOptions {
  /** Environment variable to check (default: YOJIN_KILL_SWITCH). */
  envVar?: string;
  /** File sentinel path — if this file exists, kill switch is tripped. */
  sentinelPath?: string;
}

export class KillSwitch implements Guard {
  readonly name = 'kill-switch';
  private readonly envVar: string;
  private readonly sentinelPath: string;
  private tripped = false;
  private tripReason = '';

  constructor(options?: KillSwitchOptions) {
    this.envVar = options?.envVar ?? 'YOJIN_KILL_SWITCH';
    this.sentinelPath = options?.sentinelPath ?? `${resolveDataRoot()}/.kill`;
  }

  check(_action: ProposedAction): GuardResult {
    // Check programmatic trip
    if (this.tripped) {
      return { pass: false, reason: `Kill switch active: ${this.tripReason}` };
    }

    // Check environment variable
    if (process.env[this.envVar] === '1') {
      return { pass: false, reason: `Kill switch active (${this.envVar}=1)` };
    }

    // Check sentinel file
    if (existsSync(this.sentinelPath)) {
      return { pass: false, reason: `Kill switch active (sentinel: ${this.sentinelPath})` };
    }

    return { pass: true };
  }

  /** Programmatically trip the kill switch. */
  trip(reason: string): void {
    this.tripped = true;
    this.tripReason = reason;
  }

  /** Reset the kill switch. Only for manual recovery. */
  reset(): void {
    this.tripped = false;
    this.tripReason = '';
  }

  isTripped(): boolean {
    return this.tripped || process.env[this.envVar] === '1' || existsSync(this.sentinelPath);
  }
}
