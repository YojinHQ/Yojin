import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApprovalGate } from '../../../src/trust/approval/approval-gate.js';
import { FileAuditLog } from '../../../src/trust/audit/audit-log.js';

describe('ApprovalGate', () => {
  let tempDir: string;
  let auditLog: FileAuditLog;
  let gate: ApprovalGate;

  beforeEach(() => {
    vi.useFakeTimers();
    tempDir = mkdtempSync(join(tmpdir(), 'yojin-approval-'));
    auditLog = new FileAuditLog(tempDir);
    gate = new ApprovalGate({
      auditLog,
      config: {
        actionsRequiringApproval: ['trade.execute', 'config.change'],
        timeoutMs: 5000,
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('needsApproval returns true for configured actions', () => {
    expect(gate.needsApproval('trade.execute')).toBe(true);
    expect(gate.needsApproval('config.change')).toBe(true);
  });

  it('needsApproval returns false for non-configured actions', () => {
    expect(gate.needsApproval('tool_call')).toBe(false);
    expect(gate.needsApproval('file_access')).toBe(false);
  });

  it('requestApproval + approve resolves as approved', async () => {
    const promise = gate.requestApproval('trade.execute', 'Buy 10 AAPL', 'trader');

    const pending = gate.getPending();
    expect(pending).toHaveLength(1);

    gate.resolve(pending[0].id, true);

    const result = await promise;
    expect(result.approved).toBe(true);
  });

  it('requestApproval + deny resolves as denied', async () => {
    const promise = gate.requestApproval('trade.execute', 'Sell all BTC');

    const pending = gate.getPending();
    gate.resolve(pending[0].id, false, 'Too risky');

    const result = await promise;
    expect(result.approved).toBe(false);
    if (!result.approved) {
      expect(result.reason).toBe('Too risky');
      expect(result.timedOut).toBe(false);
    }
  });

  it('auto-denies on timeout', async () => {
    const promise = gate.requestApproval('trade.execute', 'Buy 100 AAPL');

    expect(gate.getPending()).toHaveLength(1);

    vi.advanceTimersByTime(6000);

    const result = await promise;
    expect(result.approved).toBe(false);
    if (!result.approved) {
      expect(result.timedOut).toBe(true);
      expect(result.reason).toContain('timed out');
    }

    expect(gate.getPending()).toHaveLength(0);
  });

  it('logs approval.request and approval.result to audit', async () => {
    const promise = gate.requestApproval('trade.execute', 'Test trade');
    const pending = gate.getPending();
    gate.resolve(pending[0].id, true);
    await promise;

    const requestEvents = await auditLog.query({ type: 'approval.request' });
    expect(requestEvents).toHaveLength(1);
    expect(requestEvents[0].details).toMatchObject({
      action: 'trade.execute',
      description: 'Test trade',
    });

    const resultEvents = await auditLog.query({ type: 'approval.result' });
    expect(resultEvents).toHaveLength(1);
    expect(resultEvents[0].details).toMatchObject({
      approved: true,
      timedOut: false,
    });
  });

  it('configure updates which actions need approval', () => {
    expect(gate.needsApproval('platform.connect')).toBe(false);

    gate.configure({
      actionsRequiringApproval: ['trade.execute', 'platform.connect'],
    });

    expect(gate.needsApproval('platform.connect')).toBe(true);
  });

  it('getPending returns copies, not references', () => {
    gate.requestApproval('trade.execute', 'Test');
    const pending1 = gate.getPending();
    const pending2 = gate.getPending();

    expect(pending1[0]).toEqual(pending2[0]);
    expect(pending1[0]).not.toBe(pending2[0]);
  });

  it('resolve is idempotent for unknown request IDs', () => {
    // Should not throw
    gate.resolve('nonexistent-id', true);
  });

  describe('configure timeoutMs validation', () => {
    it('rejects timeoutMs below minimum (5000ms)', () => {
      expect(() => gate.configure({ timeoutMs: 0 })).toThrow('at least 5000ms');
      expect(() => gate.configure({ timeoutMs: 1000 })).toThrow('at least 5000ms');
      expect(() => gate.configure({ timeoutMs: 4999 })).toThrow('at least 5000ms');
    });

    it('accepts timeoutMs at or above minimum', () => {
      expect(() => gate.configure({ timeoutMs: 5000 })).not.toThrow();
      expect(() => gate.configure({ timeoutMs: 60000 })).not.toThrow();
    });
  });
});
