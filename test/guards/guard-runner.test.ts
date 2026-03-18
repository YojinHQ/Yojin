import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GuardRunner } from '../../src/guards/guard-runner.js';
import { RateBudgetGuard } from '../../src/guards/security/rate-budget.js';
import type { Guard, ProposedAction } from '../../src/guards/types.js';
import { FileAuditLog } from '../../src/trust/audit/audit-log.js';

function makeAction(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return { type: 'tool_call', toolName: 'test-tool', ...overrides };
}

function makePassGuard(name: string): Guard {
  return { name, check: () => ({ pass: true }) };
}

function makeBlockGuard(name: string, reason: string): Guard {
  return { name, check: () => ({ pass: false, reason }) };
}

describe('GuardRunner', () => {
  let tempDir: string;
  let auditLog: FileAuditLog;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'yojin-guard-'));
    auditLog = new FileAuditLog(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('passes when all guards pass', () => {
    const runner = new GuardRunner([makePassGuard('a'), makePassGuard('b'), makePassGuard('c')], {
      auditLog,
    });

    const result = runner.check(makeAction());
    expect(result.pass).toBe(true);
  });

  it('blocks on first failing guard', () => {
    const runner = new GuardRunner([makePassGuard('a'), makeBlockGuard('b', 'denied'), makePassGuard('c')], {
      auditLog,
    });

    const result = runner.check(makeAction());
    expect(result.pass).toBe(false);
    if (!result.pass) {
      expect(result.reason).toBe('denied');
    }
  });

  it('logs guard.pass to audit on success', async () => {
    const runner = new GuardRunner([makePassGuard('a')], { auditLog });
    runner.check(makeAction());

    const events = await auditLog.query({ type: 'guard.pass' });
    expect(events).toHaveLength(1);
    expect(events[0].details).toMatchObject({
      action: 'tool_call',
      toolName: 'test-tool',
      guardsChecked: 1,
    });
  });

  it('logs guard.block to audit on failure', async () => {
    const runner = new GuardRunner([makeBlockGuard('fs-guard', 'path blocked')], { auditLog });
    runner.check(makeAction());

    const events = await auditLog.query({ type: 'guard.block' });
    expect(events).toHaveLength(1);
    expect(events[0].details).toMatchObject({
      guardName: 'fs-guard',
      reason: 'path blocked',
    });
  });

  it('runs guards in registration order', () => {
    const order: string[] = [];
    const trackingGuard = (name: string): Guard => ({
      name,
      check: () => {
        order.push(name);
        return { pass: true };
      },
    });

    const runner = new GuardRunner([trackingGuard('first'), trackingGuard('second'), trackingGuard('third')], {
      auditLog,
    });
    runner.check(makeAction());

    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('stops checking after first block', () => {
    const order: string[] = [];
    const trackingGuard = (name: string, pass: boolean): Guard => ({
      name,
      check: () => {
        order.push(name);
        return pass ? { pass: true } : { pass: false, reason: 'blocked' };
      },
    });

    const runner = new GuardRunner([trackingGuard('a', true), trackingGuard('b', false), trackingGuard('c', true)], {
      auditLog,
    });
    runner.check(makeAction());

    expect(order).toEqual(['a', 'b']);
  });

  describe('observe mode (unbounded posture)', () => {
    it('logs blocks but returns pass', async () => {
      const runner = new GuardRunner([makeBlockGuard('test-guard', 'would block')], {
        auditLog,
        posture: 'unbounded',
      });

      const result = runner.check(makeAction());
      expect(result.pass).toBe(true);

      const blockEvents = await auditLog.query({ type: 'guard.block' });
      expect(blockEvents).toHaveLength(1);
    });

    it('guard.pass includes posture, mode, and observed blocks', async () => {
      const runner = new GuardRunner([makeBlockGuard('test-guard', 'would block')], {
        auditLog,
        posture: 'unbounded',
      });
      runner.check(makeAction());

      const passEvents = await auditLog.query({ type: 'guard.pass' });
      expect(passEvents).toHaveLength(1);
      const details = passEvents[0].details as Record<string, unknown>;
      expect(details.posture).toBe('unbounded');
      expect(details.mode).toBe('observe');
      expect(details.observedBlocks).toEqual(['test-guard']);
    });
  });

  describe('posture switching', () => {
    it('logs posture.change to audit', async () => {
      const runner = new GuardRunner([], { auditLog, posture: 'local' });
      runner.setPosture('standard');

      const events = await auditLog.query({ type: 'posture.change' });
      expect(events).toHaveLength(1);
      expect(events[0].details).toMatchObject({ from: 'local', to: 'standard' });
    });

    it('getPosture reflects the current posture', () => {
      const runner = new GuardRunner([], { auditLog, posture: 'local' });
      expect(runner.getPosture()).toBe('local');
      runner.setPosture('unbounded');
      expect(runner.getPosture()).toBe('unbounded');
    });

    it('propagates new rate limit to RateBudgetGuard on posture change', () => {
      // Local posture = 30 calls/min, Standard = 60 calls/min
      const rateBudget = new RateBudgetGuard({ maxCallsPerMinute: 30 });
      const runner = new GuardRunner([rateBudget], { auditLog, posture: 'local' });

      // Fill up to local limit (30)
      for (let i = 0; i < 30; i++) {
        const result = runner.check(makeAction());
        expect(result.pass).toBe(true);
      }

      // 31st call should be blocked at local posture
      expect(runner.check(makeAction()).pass).toBe(false);

      // Switch to standard (60/min) — rate limit should increase
      rateBudget.reset();
      runner.setPosture('standard');

      // Now we should be able to make 60 calls
      for (let i = 0; i < 60; i++) {
        const result = runner.check(makeAction());
        expect(result.pass).toBe(true);
      }

      // 61st should block
      expect(runner.check(makeAction()).pass).toBe(false);
    });
  });

  describe('dynamic guard management', () => {
    it('addGuard adds to the pipeline', () => {
      const runner = new GuardRunner([], { auditLog });
      runner.addGuard(makePassGuard('new'));
      expect(runner.getGuards()).toHaveLength(1);
      expect(runner.getGuards()[0].name).toBe('new');
    });

    it('removeGuard removes from the pipeline', () => {
      const runner = new GuardRunner([makePassGuard('a'), makePassGuard('b')], { auditLog });
      expect(runner.removeGuard('a')).toBe(true);
      expect(runner.getGuards()).toHaveLength(1);
      expect(runner.getGuards()[0].name).toBe('b');
    });

    it('removeGuard returns false for unknown guard', () => {
      const runner = new GuardRunner([], { auditLog });
      expect(runner.removeGuard('nonexistent')).toBe(false);
    });
  });

  describe('freeze', () => {
    it('prevents addGuard after freeze', () => {
      const runner = new GuardRunner([], { auditLog });
      runner.freeze();
      expect(() => runner.addGuard(makePassGuard('new'))).toThrow('frozen');
    });

    it('prevents removeGuard after freeze', () => {
      const runner = new GuardRunner([makePassGuard('a')], { auditLog });
      runner.freeze();
      expect(() => runner.removeGuard('a')).toThrow('frozen');
    });

    it('prevents setPosture after freeze', () => {
      const runner = new GuardRunner([], { auditLog, posture: 'local' });
      runner.freeze();
      expect(() => runner.setPosture('unbounded')).toThrow('frozen');
    });

    it('check still works after freeze', () => {
      const runner = new GuardRunner([makePassGuard('a')], { auditLog });
      runner.freeze();
      expect(runner.check(makeAction()).pass).toBe(true);
    });

    it('isFrozen reflects state', () => {
      const runner = new GuardRunner([], { auditLog });
      expect(runner.isFrozen()).toBe(false);
      runner.freeze();
      expect(runner.isFrozen()).toBe(true);
    });
  });
});
