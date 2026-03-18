import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { KillSwitch } from '../../../src/guards/security/kill-switch.js';
import { SelfDefenseGuard } from '../../../src/guards/security/self-defense.js';
import type { ProposedAction } from '../../../src/guards/types.js';

describe('SelfDefenseGuard', () => {
  let tempDir: string;
  let configFile: string;
  let auditFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'yojin-selfdef-'));
    configFile = join(tempDir, 'config.json');
    auditFile = join(tempDir, 'security.jsonl');
    writeFileSync(configFile, '{"posture":"local"}', 'utf-8');
    writeFileSync(auditFile, '{"event":"test"}\n', 'utf-8');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('passes for non-write actions', () => {
    const guard = new SelfDefenseGuard({ protectedPaths: [configFile] });
    const action: ProposedAction = { type: 'tool_call', path: configFile };
    expect(guard.check(action).pass).toBe(true);
  });

  it('blocks writes to protected files', () => {
    const guard = new SelfDefenseGuard({ protectedPaths: [configFile] });
    const action: ProposedAction = { type: 'file_write', path: configFile };

    const result = guard.check(action);
    expect(result.pass).toBe(false);
    if (!result.pass) {
      expect(result.reason).toContain('protected path blocked');
    }
  });

  it('blocks deletes to protected files', () => {
    const guard = new SelfDefenseGuard({ protectedPaths: [configFile] });
    const action: ProposedAction = { type: 'file_delete', path: configFile };

    expect(guard.check(action).pass).toBe(false);
  });

  it('blocks writes to subdirectories of protected paths', () => {
    const guard = new SelfDefenseGuard({ protectedPaths: [tempDir] });
    const action: ProposedAction = {
      type: 'file_write',
      path: join(tempDir, 'nested', 'file.txt'),
    };

    expect(guard.check(action).pass).toBe(false);
  });

  it('allows writes to non-protected files', () => {
    const guard = new SelfDefenseGuard({ protectedPaths: [configFile] });
    const action: ProposedAction = { type: 'file_write', path: '/tmp/safe-file.txt' };

    expect(guard.check(action).pass).toBe(true);
  });

  it('snapshots file hashes at construction', () => {
    const guard = new SelfDefenseGuard({ protectedPaths: [configFile, auditFile] });
    const files = guard.getProtectedFiles();

    expect(files.size).toBe(2);
    expect(files.has(join(tempDir, 'config.json').replace(/.*/, configFile))).toBe(true);
  });

  it('detects tampering when verifyIntegrity is enabled', () => {
    const guard = new SelfDefenseGuard({
      protectedPaths: [configFile],
      verifyIntegrity: true,
    });

    // Passes initially
    expect(guard.check({ type: 'tool_call' }).pass).toBe(true);

    // Tamper with the file
    writeFileSync(configFile, '{"posture":"unbounded","hacked":true}', 'utf-8');

    // Should detect the change
    const result = guard.check({ type: 'tool_call' });
    expect(result.pass).toBe(false);
    if (!result.pass) {
      expect(result.reason).toContain('tampered');
    }
  });

  it('trips kill switch on detected tampering', () => {
    const killSwitch = new KillSwitch({ sentinelPath: '/nonexistent/.kill' });
    const guard = new SelfDefenseGuard({
      protectedPaths: [configFile],
      killSwitch,
      verifyIntegrity: true,
    });

    expect(killSwitch.isTripped()).toBe(false);

    // Tamper
    writeFileSync(configFile, 'MODIFIED', 'utf-8');
    guard.check({ type: 'tool_call' });

    expect(killSwitch.isTripped()).toBe(true);
  });
});
