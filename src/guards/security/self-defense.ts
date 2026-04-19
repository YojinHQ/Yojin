/**
 * SelfDefenseGuard — protects critical files from modification.
 *
 * Computes SHA-256 hashes of protected files at startup. On each check,
 * if the action targets a protected file (write/delete), it blocks.
 * Optionally verifies file integrity on every check and trips the kill
 * switch if a protected file has been tampered with externally.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import type { Guard, GuardResult, ProposedAction } from '../types.js';
import type { KillSwitch } from './kill-switch.js';

export interface SelfDefenseOptions {
  /** Files to protect from modification. */
  protectedPaths: string[];
  /** Reference to the kill switch — tripped on detected tampering. */
  killSwitch?: KillSwitch;
  /** Verify file hashes on every check (default: false — only blocks writes). */
  verifyIntegrity?: boolean;
}

export class SelfDefenseGuard implements Guard {
  readonly name = 'self-defense';
  private readonly protectedPaths: string[];
  private readonly killSwitch?: KillSwitch;
  private readonly verifyIntegrity: boolean;
  private readonly fileHashes = new Map<string, string>();

  constructor(options: SelfDefenseOptions) {
    this.protectedPaths = options.protectedPaths.map((p) => resolve(p));
    this.killSwitch = options.killSwitch;
    this.verifyIntegrity = options.verifyIntegrity ?? false;

    // Snapshot all protected files at construction time
    for (const path of this.protectedPaths) {
      const hash = this.hashFile(path);
      if (hash) {
        this.fileHashes.set(path, hash);
      }
    }
  }

  check(action: ProposedAction): GuardResult {
    // Block writes/deletes targeting protected files
    if (action.path) {
      const normalized = resolve(action.path);
      const isWrite = action.type === 'file_write' || action.type === 'file_delete' || action.type === 'file_modify';

      if (isWrite) {
        for (const protectedPath of this.protectedPaths) {
          if (normalized === protectedPath || normalized.startsWith(protectedPath + sep)) {
            return {
              pass: false,
              reason: `Self-defense: write to protected path blocked: ${action.path}`,
            };
          }
        }
      }
    }

    // Optional integrity verification — detect external tampering
    if (this.verifyIntegrity) {
      for (const [path, expectedHash] of this.fileHashes) {
        const currentHash = this.hashFile(path);
        if (currentHash && currentHash !== expectedHash) {
          const reason = `Self-defense: protected file tampered: ${path}`;
          this.killSwitch?.trip(reason);
          return { pass: false, reason };
        }
      }
    }

    return { pass: true };
  }

  /** Get the set of protected paths and their startup hashes. */
  getProtectedFiles(): Map<string, string> {
    return new Map(this.fileHashes);
  }

  private hashFile(path: string): string | null {
    try {
      if (!existsSync(path)) return null;
      const content = readFileSync(path, 'utf-8');
      return createHash('sha256').update(content).digest('hex');
    } catch {
      return null;
    }
  }
}
