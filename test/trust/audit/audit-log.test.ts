import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileAuditLog } from '../../../src/trust/audit/audit-log.js';
import type { AuditEventInput } from '../../../src/trust/audit/types.js';

function makeEvent(overrides: Partial<AuditEventInput> = {}): AuditEventInput {
  return {
    type: 'guard.pass',
    details: { action: 'tool_call', toolName: 'test-tool', guardsChecked: 3 },
    ...overrides,
  };
}

describe('FileAuditLog', () => {
  let tempDir: string;
  let log: FileAuditLog;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'yojin-audit-'));
    log = new FileAuditLog(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('auto-creates audit directory on first append', () => {
    const nested = join(tempDir, 'nested', 'dir');
    const nestedLog = new FileAuditLog(nested);
    nestedLog.append(makeEvent());

    const content = readFileSync(join(nested, 'security.jsonl'), 'utf-8');
    expect(content.trim()).toBeTruthy();
  });

  it('appends valid JSONL lines', () => {
    log.append(makeEvent());
    log.append(makeEvent({ type: 'guard.block' }));

    const content = readFileSync(log.getFilePath(), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]);
    expect(first.type).toBe('guard.pass');
    expect(first.id).toBeDefined();
    expect(first.timestamp).toBeDefined();
  });

  it('auto-generates id and timestamp', () => {
    log.append(makeEvent());

    const content = readFileSync(log.getFilePath(), 'utf-8');
    const event = JSON.parse(content.trim());
    expect(event.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(new Date(event.timestamp).getTime()).toBeGreaterThan(0);
  });

  it('validates event schema on append', () => {
    expect(() => log.append({ type: 'invalid_type' as never, details: {} })).toThrow();
  });

  it('preserves agentId and sessionId', () => {
    log.append(makeEvent({ agentId: 'research-analyst', sessionId: 'sess-123' }));

    const content = readFileSync(log.getFilePath(), 'utf-8');
    const event = JSON.parse(content.trim());
    expect(event.agentId).toBe('research-analyst');
    expect(event.sessionId).toBe('sess-123');
  });

  describe('query', () => {
    beforeEach(() => {
      log.append(makeEvent({ type: 'guard.pass', agentId: 'agent-a' }));
      log.append(
        makeEvent({
          type: 'guard.block',
          agentId: 'agent-b',
          details: { action: 'file_access', guardName: 'fs-guard', reason: 'blocked' },
        }),
      );
      log.append(
        makeEvent({
          type: 'secret.access',
          agentId: 'agent-a',
          details: { key: 'API_KEY', operation: 'get' },
        }),
      );
    });

    it('returns all events when no filter', async () => {
      const events = await log.query();
      expect(events).toHaveLength(3);
    });

    it('filters by type', async () => {
      const events = await log.query({ type: 'guard.pass' });
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('guard.pass');
    });

    it('filters by agentId', async () => {
      const events = await log.query({ agentId: 'agent-a' });
      expect(events).toHaveLength(2);
    });

    it('respects limit (returns last N)', async () => {
      const events = await log.query({ limit: 1 });
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('secret.access');
    });

    it('returns empty array when file does not exist', async () => {
      const emptyLog = new FileAuditLog(join(tempDir, 'nonexistent'));
      const events = await emptyLog.query();
      expect(events).toEqual([]);
    });
  });

  it('is append-only — multiple appends do not clobber', () => {
    log.append(makeEvent());
    log.append(makeEvent());
    log.append(makeEvent());

    const content = readFileSync(log.getFilePath(), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(3);

    // Each line has a unique id
    const ids = lines.map((l) => JSON.parse(l).id);
    expect(new Set(ids).size).toBe(3);
  });
});
