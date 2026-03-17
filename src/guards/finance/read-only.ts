/**
 * ReadOnlyGuard — blocks all write/trade actions when in read-only mode.
 */

import type { Guard, GuardResult, ProposedAction } from '../types.js';

const WRITE_ACTION_TYPES = new Set(['trade', 'write', 'delete', 'create', 'update']);

export class ReadOnlyGuard implements Guard {
  readonly name = 'read-only';
  private enabled: boolean;

  constructor(options?: { enabled?: boolean }) {
    this.enabled = options?.enabled ?? false;
  }

  check(action: ProposedAction): GuardResult {
    if (!this.enabled) return { pass: true };

    if (WRITE_ACTION_TYPES.has(action.type)) {
      return {
        pass: false,
        reason: `Read-only mode: ${action.type} actions are blocked`,
      };
    }

    return { pass: true };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}
