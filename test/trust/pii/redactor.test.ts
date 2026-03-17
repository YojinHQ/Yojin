import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileAuditLog } from '../../../src/trust/audit/audit-log.js';
import { balanceToRange, hashAccountId } from '../../../src/trust/pii/patterns.js';
import { DefaultPiiRedactor } from '../../../src/trust/pii/redactor.js';

describe('balanceToRange', () => {
  it('maps values to correct ranges', () => {
    expect(balanceToRange(0)).toBe('$0-$1k');
    expect(balanceToRange(500)).toBe('$0-$1k');
    expect(balanceToRange(999)).toBe('$0-$1k');
    expect(balanceToRange(1000)).toBe('$1k-$10k');
    expect(balanceToRange(9999)).toBe('$1k-$10k');
    expect(balanceToRange(10000)).toBe('$10k-$50k');
    expect(balanceToRange(49999)).toBe('$10k-$50k');
    expect(balanceToRange(50000)).toBe('$50k-$100k');
    expect(balanceToRange(99999)).toBe('$50k-$100k');
    expect(balanceToRange(100000)).toBe('$100k-$500k');
    expect(balanceToRange(499999)).toBe('$100k-$500k');
    expect(balanceToRange(500000)).toBe('$500k-$1M');
    expect(balanceToRange(999999)).toBe('$500k-$1M');
    expect(balanceToRange(1000000)).toBe('$1M+');
    expect(balanceToRange(50000000)).toBe('$1M+');
  });

  it('handles negative values (uses absolute)', () => {
    expect(balanceToRange(-500)).toBe('$0-$1k');
    expect(balanceToRange(-50000)).toBe('$50k-$100k');
  });
});

describe('hashAccountId', () => {
  it('is deterministic', () => {
    expect(hashAccountId('12345678')).toBe(hashAccountId('12345678'));
  });

  it('produces different hashes for different IDs', () => {
    expect(hashAccountId('12345678')).not.toBe(hashAccountId('87654321'));
  });

  it('returns formatted hash', () => {
    const hash = hashAccountId('12345678');
    expect(hash).toMatch(/^<ACCT-[a-f0-9]{8}>$/);
  });
});

describe('DefaultPiiRedactor', () => {
  let tempDir: string;
  let auditLog: FileAuditLog;
  let redactor: DefaultPiiRedactor;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'yojin-pii-'));
    auditLog = new FileAuditLog(tempDir);
    redactor = new DefaultPiiRedactor({ auditLog });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('redacts account IDs in specific fields', () => {
    const { data } = redactor.redact({
      accountId: '12345678',
      name: 'test',
    });

    expect(data.accountId).toMatch(/^<ACCT-[a-f0-9]{8}>$/);
    expect(data.accountId).not.toBe('12345678');
  });

  it('does not redact account ID patterns in non-matching fields', () => {
    const { data } = redactor.redact({
      someNumber: '12345678',
    });

    expect(data.someNumber).toBe('12345678');
  });

  it('redacts email addresses', () => {
    const { data } = redactor.redact({
      description: 'Contact john@example.com for details',
    });

    expect(data.description).toBe('Contact <EMAIL-REDACTED> for details');
  });

  it('redacts names in specific fields', () => {
    const { data } = redactor.redact({
      ownerName: 'John Doe',
      symbol: 'AAPL',
    });

    expect(data.ownerName).toBe('<NAME-REDACTED>');
    expect(data.symbol).toBe('AAPL');
  });

  it('redacts balance fields to ranges', () => {
    const { data } = redactor.redact({
      balance: 75000,
      totalValue: 150000,
      symbol: 'AAPL',
    });

    expect(data.balance).toBe('$50k-$100k');
    expect(data.totalValue).toBe('$100k-$500k');
    expect(data.symbol).toBe('AAPL');
  });

  it('never mutates the original object', () => {
    const original = {
      accountId: '12345678',
      balance: 50000,
      ownerName: 'Test User',
    };
    const frozen = JSON.parse(JSON.stringify(original));

    redactor.redact(original);

    expect(original).toEqual(frozen);
  });

  it('handles nested objects', () => {
    const { data } = redactor.redact({
      portfolio: {
        accountId: '12345678',
        balance: 25000,
        positions: [{ symbol: 'AAPL', marketValue: 15000 }],
      },
    });

    const portfolio = data.portfolio as Record<string, unknown>;
    expect(portfolio.accountId).toMatch(/^<ACCT-/);
    expect(portfolio.balance).toBe('$10k-$50k');

    const positions = portfolio.positions as Array<Record<string, unknown>>;
    expect(positions[0].symbol).toBe('AAPL');
    expect(positions[0].marketValue).toBe('$10k-$50k');
  });

  it('is deterministic — same input produces same output', () => {
    const input = { accountId: '12345678', balance: 50000 };

    const result1 = redactor.redact(input);
    const result2 = redactor.redact(input);

    expect(result1.data).toEqual(result2.data);
    expect(result1.metadata.hash).toBe(result2.metadata.hash);
  });

  it('returns metadata with field count and rules applied', () => {
    const { metadata } = redactor.redact({
      accountId: '12345678',
      balance: 50000,
      ownerName: 'John',
    });

    expect(metadata.fieldsRedacted).toBe(3);
    expect(metadata.rulesApplied).toContain('account-id');
    expect(metadata.rulesApplied).toContain('name');
    expect(metadata.rulesApplied).toContain('balance-range');
    expect(metadata.hash).toBeDefined();
  });

  it('tracks cumulative stats', () => {
    redactor.redact({ accountId: '12345678' });
    redactor.redact({ ownerName: 'Test' });

    const stats = redactor.getStats();
    expect(stats.callsProcessed).toBe(2);
    expect(stats.fieldsRedacted).toBe(2);
  });

  it('supports custom rules', () => {
    redactor.addRule({
      name: 'custom',
      pattern: /SECRET/g,
      replacement: '<REDACTED>',
    });

    const { data } = redactor.redact({ msg: 'This is SECRET data' });
    expect(data.msg).toBe('This is <REDACTED> data');
  });

  it('logs pii.redact to audit', async () => {
    redactor.redact({ accountId: '12345678' });

    const events = await auditLog.query({ type: 'pii.redact' });
    expect(events).toHaveLength(1);
    expect(events[0].details).toMatchObject({
      fieldsRedacted: 1,
    });
  });

  it('handles empty objects', () => {
    const { data, metadata } = redactor.redact({});
    expect(data).toEqual({});
    expect(metadata.fieldsRedacted).toBe(0);
  });

  it('preserves non-PII fields exactly', () => {
    const { data } = redactor.redact({
      symbol: 'AAPL',
      price: 150.25,
      isActive: true,
      tags: ['tech', 'large-cap'],
    });

    expect(data.symbol).toBe('AAPL');
    expect(data.price).toBe(150.25);
    expect(data.isActive).toBe(true);
    expect(data.tags).toEqual(['tech', 'large-cap']);
  });
});
