import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ToolRegistry } from '../../src/core/tool-registry.js';
import { GuardRunner } from '../../src/guards/guard-runner.js';
import { OutputDlpGuard } from '../../src/guards/security/output-dlp.js';
import type { Guard } from '../../src/guards/types.js';
import { FileAuditLog } from '../../src/trust/audit/audit-log.js';
import { GuardedToolRegistry } from '../../src/trust/guarded-tool-registry.js';

function makeBlockGuard(name: string, reason: string): Guard {
  return { name, check: () => ({ pass: false, reason }) };
}

function makePassGuard(name: string): Guard {
  return { name, check: () => ({ pass: true }) };
}

describe('GuardedToolRegistry', () => {
  let tempDir: string;
  let auditLog: FileAuditLog;
  let innerRegistry: ToolRegistry;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'yojin-guarded-'));
    auditLog = new FileAuditLog(tempDir);
    innerRegistry = new ToolRegistry();

    // Register a test tool
    innerRegistry.register({
      name: 'echo',
      description: 'Echo input back',
      parameters: z.object({ message: z.string() }),
      execute: async (params) => ({ content: params.message }),
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('passes through to inner registry when guards pass', async () => {
    const runner = new GuardRunner([makePassGuard('test')], { auditLog });
    const guarded = new GuardedToolRegistry({ registry: innerRegistry, guardRunner: runner });

    const result = await guarded.execute('echo', { message: 'hello' });
    expect(result.content).toBe('hello');
    expect(result.isError).toBeUndefined();
  });

  it('blocks when guard fails', async () => {
    const runner = new GuardRunner([makeBlockGuard('fs-guard', 'path not allowed')], { auditLog });
    const guarded = new GuardedToolRegistry({ registry: innerRegistry, guardRunner: runner });

    const result = await guarded.execute('echo', { message: 'hello' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Blocked by guard');
    expect(result.content).toContain('path not allowed');
  });

  it('records guard events in audit log', async () => {
    const runner = new GuardRunner([makePassGuard('test')], { auditLog });
    const guarded = new GuardedToolRegistry({ registry: innerRegistry, guardRunner: runner });

    await guarded.execute('echo', { message: 'hello' });

    const events = await auditLog.query({ type: 'guard.pass' });
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('output-dlp catches leaked secrets in tool output', async () => {
    // Register a tool that returns a secret
    innerRegistry.register({
      name: 'leaky-tool',
      description: 'Returns a secret',
      parameters: z.object({}),
      execute: async () => ({
        content: 'Here is the key: AKIAIOSFODNN7EXAMPLE',
      }),
    });

    const runner = new GuardRunner([makePassGuard('test')], { auditLog });
    const guarded = new GuardedToolRegistry({
      registry: innerRegistry,
      guardRunner: runner,
      outputDlp: new OutputDlpGuard(),
    });

    const result = await guarded.execute('leaky-tool', {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Output blocked by DLP');
  });

  it('allows clean output through DLP', async () => {
    const runner = new GuardRunner([makePassGuard('test')], { auditLog });
    const guarded = new GuardedToolRegistry({
      registry: innerRegistry,
      guardRunner: runner,
      outputDlp: new OutputDlpGuard(),
    });

    const result = await guarded.execute('echo', { message: 'AAPL is at $150' });
    expect(result.content).toBe('AAPL is at $150');
    expect(result.isError).toBeUndefined();
  });

  it('exposes inner registry', () => {
    const runner = new GuardRunner([], { auditLog });
    const guarded = new GuardedToolRegistry({ registry: innerRegistry, guardRunner: runner });

    expect(guarded.inner).toBe(innerRegistry);
    expect(guarded.inner.has('echo')).toBe(true);
  });
});
