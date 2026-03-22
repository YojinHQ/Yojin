/**
 * Default PII redaction rules.
 */

import { createHash } from 'node:crypto';

import type { RedactionRule } from './types.js';

/** Hash an account ID deterministically (same input = same output). */
export function hashAccountId(id: string): string {
  return '<ACCT-' + createHash('sha256').update(id).digest('hex').slice(0, 8) + '>';
}

/** Convert an exact quantity to a bucketed range string. Preserves sign for short positions. */
export function quantityToRange(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs < 1) return `${sign}<1 unit`;
  if (abs < 10) return `${sign}1-10 units`;
  if (abs < 100) return `${sign}10-100 units`;
  if (abs < 1_000) return `${sign}100-1k units`;
  if (abs < 10_000) return `${sign}1k-10k units`;
  return `${sign}10k+ units`;
}

/** Convert an exact balance to a range string. */
export function balanceToRange(value: number): string {
  const abs = Math.abs(value);
  if (abs < 1_000) return '$0-$1k';
  if (abs < 10_000) return '$1k-$10k';
  if (abs < 50_000) return '$10k-$50k';
  if (abs < 100_000) return '$50k-$100k';
  if (abs < 500_000) return '$100k-$500k';
  if (abs < 1_000_000) return '$500k-$1M';
  return '$1M+';
}

export const DEFAULT_PII_RULES: RedactionRule[] = [
  // Account IDs: numeric sequences 6-12 digits in specific fields
  {
    name: 'account-id',
    pattern: /^\d{6,12}$/,
    replacement: (match: string) => hashAccountId(match),
    fields: ['accountId', 'account_id', 'portfolioId', 'portfolio_id'],
  },
  // Email addresses
  {
    name: 'email',
    pattern: /\b[\w.-]+@[\w.-]+\.\w{2,}\b/g,
    replacement: '<EMAIL-REDACTED>',
  },
  // Names in specific fields
  {
    name: 'name',
    pattern: /.+/,
    replacement: '<NAME-REDACTED>',
    fields: ['accountName', 'account_name', 'ownerName', 'owner_name', 'userName', 'user_name', 'displayName'],
  },
  // Phone numbers
  {
    name: 'phone',
    pattern: /\+?\d[\d\s()-]{7,}\d/g,
    replacement: '<PHONE-REDACTED>',
  },
  // SSN-like patterns
  {
    name: 'ssn',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: '<SSN-REDACTED>',
  },
];
