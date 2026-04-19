import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileAuditLog } from '../../../src/trust/audit/audit-log.js';
import { ChatPiiScanner } from '../../../src/trust/pii/chat-scanner.js';

describe('ChatPiiScanner', () => {
  let tempDir: string;
  let auditLog: FileAuditLog;
  let scanner: ChatPiiScanner;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'yojin-chat-pii-'));
    auditLog = new FileAuditLog(tempDir);
    scanner = new ChatPiiScanner({ auditLog });
  });

  afterEach(async () => {
    await scanner.dispose();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('passes through text with no PII', async () => {
    const result = await scanner.scrub('What is the price of AAPL?');
    expect(result.sanitized).toBe('What is the price of AAPL?');
    expect(result.entitiesFound).toBe(0);
    expect(result.typesFound).toEqual([]);
  });

  it('masks email addresses', async () => {
    const result = await scanner.scrub('Contact me at dean@example.com for details');
    expect(result.sanitized).not.toContain('dean@example.com');
    expect(result.sanitized).toContain('PII');
    expect(result.entitiesFound).toBeGreaterThanOrEqual(1);
    expect(result.typesFound).toContain('EMAIL');
    expect(result.piiMap).toBeDefined();
  });

  it('masks phone numbers', async () => {
    const result = await scanner.scrub('Call me at +1-555-123-4567');
    expect(result.sanitized).not.toContain('555-123-4567');
    expect(result.entitiesFound).toBeGreaterThanOrEqual(1);
    expect(result.typesFound).toContain('PHONE');
  });

  it('masks credit card numbers', async () => {
    const result = await scanner.scrub('My card is 4111 1111 1111 1111');
    expect(result.sanitized).not.toContain('4111');
    expect(result.entitiesFound).toBeGreaterThanOrEqual(1);
    expect(result.typesFound).toContain('CREDIT_CARD');
  });

  it('does not mask IP addresses (passes through non-sensitive technical content)', async () => {
    const result = await scanner.scrub('Server is at 192.168.1.100');
    expect(result.sanitized).toBe('Server is at 192.168.1.100');
    expect(result.entitiesFound).toBe(0);
  });

  it('does not mask URLs (public-market content like Amazon.com must reach the LLM intact)', async () => {
    const result = await scanner.scrub('Amazon.com announced a partnership with OpenAI');
    expect(result.sanitized).toBe('Amazon.com announced a partnership with OpenAI');
    expect(result.entitiesFound).toBe(0);
  });

  it('restores PII in LLM response', async () => {
    const scrubbed = await scanner.scrub('My email is dean@example.com');
    expect(scrubbed.piiMap).toBeDefined();

    // Simulate LLM echoing the masked text back
    const restored = await scanner.restore(scrubbed.sanitized, scrubbed.piiMap!);
    expect(restored).toContain('dean@example.com');
  });

  it('handles multiple PII types in one message', async () => {
    const result = await scanner.scrub('Email dean@test.com, call +1-555-999-0000, card 4111 1111 1111 1111');
    expect(result.entitiesFound).toBeGreaterThanOrEqual(3);
    expect(result.typesFound).toContain('EMAIL');
    expect(result.typesFound).toContain('PHONE');
    expect(result.typesFound).toContain('CREDIT_CARD');
  });

  it('logs pii.redact to audit log', async () => {
    await scanner.scrub('Email: dean@example.com');
    const events = await auditLog.query({ type: 'pii.redact' });
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('is deterministic — same input produces same tag structure', async () => {
    const result1 = await scanner.scrub('dean@example.com');
    const result2 = await scanner.scrub('dean@example.com');
    // Tags should have the same structure (type + id), though encrypted maps differ
    expect(result1.entitiesFound).toBe(result2.entitiesFound);
    expect(result1.typesFound).toEqual(result2.typesFound);
  });
});
