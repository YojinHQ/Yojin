import { homedir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { FsGuard } from '../../../src/guards/security/fs-guard.js';
import type { ProposedAction } from '../../../src/guards/types.js';

const HOME = homedir();

function readAction(path: string): ProposedAction {
  return { type: 'file_access', path };
}

function writeAction(path: string): ProposedAction {
  return { type: 'file_write', path };
}

function deleteAction(path: string): ProposedAction {
  return { type: 'file_delete', path };
}

describe('FsGuard', () => {
  const guard = new FsGuard();

  it('passes when no path in action', () => {
    expect(guard.check({ type: 'tool_call' }).pass).toBe(true);
  });

  describe('read-blocked paths (no access at all)', () => {
    it('blocks read access to ~/.ssh', () => {
      expect(guard.check(readAction(`${HOME}/.ssh/id_rsa`)).pass).toBe(false);
    });

    it('blocks write access to ~/.ssh', () => {
      expect(guard.check(writeAction(`${HOME}/.ssh/authorized_keys`)).pass).toBe(false);
    });

    it('blocks access to ~/.aws', () => {
      expect(guard.check(readAction(`${HOME}/.aws/credentials`)).pass).toBe(false);
    });

    it('blocks access to ~/.gnupg', () => {
      expect(guard.check(readAction(`${HOME}/.gnupg/private-keys-v1.d`)).pass).toBe(false);
    });

    it('blocks access to /etc/shadow', () => {
      expect(guard.check(readAction('/etc/shadow')).pass).toBe(false);
    });

    it('blocks path traversal attempts', () => {
      // ${HOME}/foo/../.ssh resolves to ${HOME}/.ssh
      expect(guard.check(readAction(`${HOME}/foo/../.ssh/id_rsa`)).pass).toBe(false);
    });
  });

  describe('write-blocked paths (reads allowed, writes blocked)', () => {
    it('allows reading /etc/passwd', () => {
      expect(guard.check(readAction('/etc/passwd')).pass).toBe(true);
    });

    it('blocks writing to /etc/passwd', () => {
      expect(guard.check(writeAction('/etc/passwd')).pass).toBe(false);
    });

    it('blocks deleting from write-blocked paths', () => {
      expect(guard.check(deleteAction('/etc/passwd')).pass).toBe(false);
    });

    it('allows reading audit log', () => {
      const result = guard.check(readAction('data/audit/security.jsonl'));
      expect(result.pass).toBe(true);
    });

    it('blocks writing to audit log', () => {
      const result = guard.check(writeAction('data/audit/security.jsonl'));
      expect(result.pass).toBe(false);
    });
  });

  describe('allowed paths', () => {
    it('allows read/write to normal paths', () => {
      expect(guard.check(readAction('/tmp/test.json')).pass).toBe(true);
      expect(guard.check(writeAction('/tmp/test.json')).pass).toBe(true);
      expect(guard.check(readAction(`${HOME}/projects/yojin/data/config.json`)).pass).toBe(true);
    });
  });

  describe('custom options', () => {
    it('supports custom read-blocked paths', () => {
      const custom = new FsGuard({ readBlockedPaths: ['/custom/secret'] });
      expect(custom.check(readAction('/custom/secret/file.txt')).pass).toBe(false);
      // Default blocks are replaced, not merged
      expect(custom.check(readAction(`${HOME}/.ssh/id_rsa`)).pass).toBe(true);
    });

    it('supports custom write-blocked paths', () => {
      const custom = new FsGuard({ writeBlockedPaths: ['/custom/readonly'] });
      expect(custom.check(readAction('/custom/readonly/file.txt')).pass).toBe(true);
      expect(custom.check(writeAction('/custom/readonly/file.txt')).pass).toBe(false);
    });

    it('supports legacy blockedPaths option (treated as read-blocked)', () => {
      const custom = new FsGuard({ blockedPaths: ['/legacy/blocked'] });
      expect(custom.check(readAction('/legacy/blocked/file.txt')).pass).toBe(false);
      expect(custom.check(writeAction('/legacy/blocked/file.txt')).pass).toBe(false);
    });
  });
});
