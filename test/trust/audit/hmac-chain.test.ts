import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileAuditLog } from '../../../src/trust/audit/audit-log.js';
import type { AuditEventInput } from '../../../src/trust/audit/types.js';

function makeEvent(overrides: Partial<AuditEventInput> = {}): AuditEventInput {
  return {
    type: 'guard.pass',
    details: { action: 'tool_call', toolName: 'test', guardsChecked: 1 },
    ...overrides,
  };
}

describe('HMAC Chain', () => {
  let tempDir: string;
  let log: FileAuditLog;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'yojin-hmac-'));
    log = new FileAuditLog(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('includes prevHash and hash in events', () => {
    log.append(makeEvent());

    const content = readFileSync(log.getFilePath(), 'utf-8');
    const event = JSON.parse(content.trim());
    expect(event.prevHash).toBeDefined();
    expect(event.hash).toBeDefined();
    expect(event.hash).not.toBe(event.prevHash);
  });

  it('chains events — each prevHash equals previous hash', () => {
    log.append(makeEvent());
    log.append(makeEvent({ type: 'guard.block' }));
    log.append(makeEvent({ type: 'secret.access' }));

    const content = readFileSync(log.getFilePath(), 'utf-8');
    const events = content
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));

    // First event prevHash is the zero hash
    expect(events[0].prevHash).toMatch(/^0+$/);

    // Each subsequent event chains to the previous
    expect(events[1].prevHash).toBe(events[0].hash);
    expect(events[2].prevHash).toBe(events[1].hash);
  });

  it('verifyChain passes for untampered log', async () => {
    log.append(makeEvent());
    log.append(makeEvent({ type: 'guard.block' }));
    log.append(makeEvent({ type: 'secret.access' }));

    const result = await log.verifyChain();
    expect(result.valid).toBe(true);
  });

  it('verifyChain detects tampered event', async () => {
    log.append(makeEvent());
    log.append(makeEvent({ type: 'guard.block' }));
    log.append(makeEvent());

    // Tamper with the second event
    const content = readFileSync(log.getFilePath(), 'utf-8');
    const lines = content.trim().split('\n');
    const event = JSON.parse(lines[1]);
    event.details.guardName = 'INJECTED';
    lines[1] = JSON.stringify(event);
    writeFileSync(log.getFilePath(), lines.join('\n') + '\n', 'utf-8');

    // Re-create log instance to reload
    const freshLog = new FileAuditLog(tempDir);
    const result = await freshLog.verifyChain();
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.brokenAt).toBe(1);
      expect(result.reason).toContain('HMAC mismatch');
    }
  });

  it('verifyChain detects deleted event (chain break)', async () => {
    log.append(makeEvent());
    log.append(makeEvent({ type: 'guard.block' }));
    log.append(makeEvent());

    // Delete the middle event — third event's prevHash won't match first event's hash
    const content = readFileSync(log.getFilePath(), 'utf-8');
    const lines = content.trim().split('\n');
    lines.splice(1, 1); // remove second line
    writeFileSync(log.getFilePath(), lines.join('\n') + '\n', 'utf-8');

    const freshLog = new FileAuditLog(tempDir);
    const result = await freshLog.verifyChain();
    expect(result.valid).toBe(false);
    if (!result.valid) {
      // The remaining event at index 1 has a prevHash that doesn't match event 0's hash
      expect(result.brokenAt).toBe(1);
    }
  });

  it('loads last hash on construction for continuing chains', async () => {
    log.append(makeEvent());
    log.append(makeEvent());

    // Create new instance — should load the last hash
    const log2 = new FileAuditLog(tempDir);
    log2.append(makeEvent());

    // Chain should be valid across instances
    const result = await log2.verifyChain();
    expect(result).toEqual({ valid: true });
  });

  it('verifyChain returns valid for empty log', async () => {
    const result = await log.verifyChain();
    expect(result.valid).toBe(true);
  });

  it('verifyChain detects stripped prevHash field', async () => {
    log.append(makeEvent());
    log.append(makeEvent({ type: 'guard.block' }));

    // Strip prevHash from the second event
    const content = readFileSync(log.getFilePath(), 'utf-8');
    const lines = content.trim().split('\n');
    const event = JSON.parse(lines[1]);
    delete event.prevHash;
    // Recompute hash without prevHash to simulate a sophisticated attacker
    lines[1] = JSON.stringify(event);
    writeFileSync(log.getFilePath(), lines.join('\n') + '\n', 'utf-8');

    const freshLog = new FileAuditLog(tempDir);
    const result = await freshLog.verifyChain();
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.brokenAt).toBe(1);
      expect(result.reason).toContain('prevHash mismatch');
    }
  });

  it('verifyChain detects stripped hash field', async () => {
    log.append(makeEvent());
    log.append(makeEvent({ type: 'guard.block' }));

    // Strip hash from the first event
    const content = readFileSync(log.getFilePath(), 'utf-8');
    const lines = content.trim().split('\n');
    const event = JSON.parse(lines[0]);
    delete event.hash;
    lines[0] = JSON.stringify(event);
    writeFileSync(log.getFilePath(), lines.join('\n') + '\n', 'utf-8');

    const freshLog = new FileAuditLog(tempDir);
    const result = await freshLog.verifyChain();
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.brokenAt).toBe(0);
      expect(result.reason).toContain('Missing hash');
    }
  });
});
