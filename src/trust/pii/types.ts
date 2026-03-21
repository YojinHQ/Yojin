/**
 * PII redaction types.
 */

import type { Platform, Position } from '../../api/graphql/types.js';

/** Position with balance fields converted to range strings by PII redaction. */
export type RedactedPosition = Omit<Position, 'costBasis' | 'marketValue' | 'unrealizedPnl'> & {
  costBasis: string;
  marketValue: string;
  unrealizedPnl: string;
};

/** Snapshot with balance fields converted to range strings by PII redaction. */
export interface RedactedSnapshot {
  id: string;
  positions: RedactedPosition[];
  totalValue: string;
  totalCost: string;
  totalPnl: string;
  totalPnlPercent: string | number;
  timestamp: string;
  platform: Platform | null;
}

export interface RedactionRule {
  /** Rule identifier. */
  name: string;
  /** Regex pattern to match. */
  pattern: RegExp;
  /** Replacement string or function. */
  replacement: string | ((match: string) => string);
  /** If specified, only apply to these field names. Otherwise apply to all string fields. */
  fields?: string[];
}

export interface RedactionMetadata {
  fieldsRedacted: number;
  rulesApplied: string[];
  /** SHA-256 hash of original data for audit correlation. */
  hash: string;
}

export interface PiiRedactor {
  /** Redact PII from an object. Returns a new deep copy with redacted values. */
  redact<T extends Record<string, unknown>>(data: T): { data: T; metadata: RedactionMetadata };
  /** Add a custom redaction pattern. */
  addRule(rule: RedactionRule): void;
  /** Get cumulative stats. */
  getStats(): { fieldsRedacted: number; callsProcessed: number };
}
