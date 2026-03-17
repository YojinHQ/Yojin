/**
 * RepetitionGuard — blocks identical repeated tool calls.
 *
 * Prevents runaway loops by tracking a hash of (toolName + input)
 * and blocking if the same call repeats too many times in a window.
 */

import { createHash } from 'node:crypto';

import type { Guard, GuardResult, ProposedAction } from '../types.js';

export interface RepetitionGuardOptions {
  /** Max identical calls before blocking (default: 3). */
  maxIdenticalCalls?: number;
  /** Window in milliseconds (default: 60000 = 1 minute). */
  windowMs?: number;
}

interface CallRecord {
  hash: string;
  timestamps: number[];
}

export class RepetitionGuard implements Guard {
  readonly name = 'repetition-guard';
  private readonly maxCalls: number;
  private readonly windowMs: number;
  private readonly records = new Map<string, CallRecord>();

  constructor(options?: RepetitionGuardOptions) {
    this.maxCalls = options?.maxIdenticalCalls ?? 3;
    this.windowMs = options?.windowMs ?? 60_000;
  }

  check(action: ProposedAction): GuardResult {
    if (!action.toolName) return { pass: true };

    const hash = this.hashAction(action);
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let record = this.records.get(hash);
    if (!record) {
      record = { hash, timestamps: [] };
      this.records.set(hash, record);
    }

    // Purge old entries
    record.timestamps = record.timestamps.filter((t) => t >= windowStart);

    if (record.timestamps.length >= this.maxCalls) {
      return {
        pass: false,
        reason: `Repetition blocked: ${action.toolName} called ${record.timestamps.length} times in ${this.windowMs / 1000}s`,
      };
    }

    record.timestamps.push(now);
    return { pass: true };
  }

  /** Reset all tracking (for testing). */
  reset(): void {
    this.records.clear();
  }

  private hashAction(action: ProposedAction): string {
    const key = JSON.stringify({ tool: action.toolName, input: action.input });
    return createHash('sha256').update(key).digest('hex').slice(0, 16);
  }
}
