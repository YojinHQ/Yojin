/**
 * Default PII redaction rules.
 */

import { createHash } from 'node:crypto';

import type { RedactionRule } from './types.js';

/** Hash an account ID deterministically (same input = same output). */
export function hashAccountId(id: string): string {
  return '<ACCT-' + createHash('sha256').update(id).digest('hex').slice(0, 8) + '>';
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
