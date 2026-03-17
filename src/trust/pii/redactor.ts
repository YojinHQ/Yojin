/**
 * DefaultPiiRedactor — strips identifying information before external calls.
 *
 * Returns a new deep copy with redacted values. Never mutates the original.
 * Account IDs are hashed deterministically (same ID = same hash across calls).
 */

import { createHash } from 'node:crypto';

import { DEFAULT_PII_RULES, balanceToRange } from './patterns.js';
import type { PiiRedactor, RedactionMetadata, RedactionRule } from './types.js';
import type { AuditLog } from '../audit/types.js';

export interface PiiRedactorOptions {
  auditLog: AuditLog;
  rules?: RedactionRule[];
}

export class DefaultPiiRedactor implements PiiRedactor {
  private readonly auditLog: AuditLog;
  private rules: RedactionRule[];
  private stats = { fieldsRedacted: 0, callsProcessed: 0 };

  constructor(options: PiiRedactorOptions) {
    this.auditLog = options.auditLog;
    this.rules = [...(options.rules ?? DEFAULT_PII_RULES)];
  }

  redact<T extends Record<string, unknown>>(data: T): { data: T; metadata: RedactionMetadata } {
    const originalHash = createHash('sha256').update(JSON.stringify(data)).digest('hex');

    const rulesApplied = new Set<string>();
    let fieldsRedacted = 0;

    const redacted = this.deepRedact(data, '', rulesApplied, (count) => {
      fieldsRedacted += count;
    });

    this.stats.callsProcessed++;
    this.stats.fieldsRedacted += fieldsRedacted;

    const metadata: RedactionMetadata = {
      fieldsRedacted,
      rulesApplied: [...rulesApplied],
      hash: originalHash,
    };

    this.auditLog.append({
      type: 'pii.redact',
      details: {
        fieldsRedacted: metadata.fieldsRedacted,
        rulesApplied: metadata.rulesApplied,
        hash: metadata.hash,
      },
    });

    return { data: redacted as T, metadata };
  }

  addRule(rule: RedactionRule): void {
    this.rules.push(rule);
  }

  getStats(): { fieldsRedacted: number; callsProcessed: number } {
    return { ...this.stats };
  }

  private deepRedact(
    obj: unknown,
    path: string,
    rulesApplied: Set<string>,
    onRedact: (count: number) => void,
  ): unknown {
    if (obj === null || obj === undefined) return obj;

    if (Array.isArray(obj)) {
      return obj.map((item, i) => this.deepRedact(item, `${path}[${i}]`, rulesApplied, onRedact));
    }

    if (typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        const fieldPath = path ? `${path}.${key}` : key;

        // Handle numeric balance fields specially
        if (this.isBalanceField(key) && typeof value === 'number') {
          result[key] = balanceToRange(value);
          rulesApplied.add('balance-range');
          onRedact(1);
          continue;
        }

        if (typeof value === 'string') {
          const { redacted, applied } = this.applyRules(value, key);
          if (applied.length > 0) {
            result[key] = redacted;
            for (const name of applied) rulesApplied.add(name);
            onRedact(1);
          } else {
            result[key] = value;
          }
        } else {
          result[key] = this.deepRedact(value, fieldPath, rulesApplied, onRedact);
        }
      }
      return result;
    }

    return obj;
  }

  private applyRules(value: string, fieldName: string): { redacted: string; applied: string[] } {
    let result = value;
    const applied: string[] = [];

    for (const rule of this.rules) {
      // If rule has specific fields, only apply to those
      if (rule.fields && !rule.fields.includes(fieldName)) continue;

      // Reset regex lastIndex for global patterns
      if (rule.pattern.global) {
        rule.pattern.lastIndex = 0;
      }

      if (rule.pattern.test(result)) {
        // Reset lastIndex again for replace
        if (rule.pattern.global) {
          rule.pattern.lastIndex = 0;
        }

        if (typeof rule.replacement === 'function') {
          result = result.replace(rule.pattern, rule.replacement);
        } else {
          result = result.replace(rule.pattern, rule.replacement);
        }
        applied.push(rule.name);
      }
    }

    return { redacted: result, applied };
  }

  private isBalanceField(key: string): boolean {
    const balanceKeys = new Set([
      'balance',
      'totalValue',
      'total_value',
      'marketValue',
      'market_value',
      'costBasis',
      'cost_basis',
      'unrealizedPnl',
      'unrealized_pnl',
      'dayChange',
      'day_change',
      'totalGain',
      'total_gain',
    ]);
    return balanceKeys.has(key);
  }
}
