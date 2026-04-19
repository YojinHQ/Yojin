/**
 * FsGuard — blocks file access to sensitive system paths.
 *
 * Separates read-blocked paths (always blocked, e.g. ~/.ssh private keys)
 * from write-blocked paths (block writes only, e.g. /etc/hosts, audit/).
 *
 * Read-blocked paths block ALL access (read + write).
 * Write-blocked paths only block writes — reads are allowed.
 */

import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

import { resolveDataRoot } from '../../paths.js';
import type { Guard, GuardResult, ProposedAction } from '../types.js';

const HOME = homedir();

/** Paths where ALL access (read + write) is blocked. */
const DEFAULT_READ_BLOCKED_PATHS = [
  `${HOME}/.ssh`,
  `${HOME}/.aws`,
  `${HOME}/.gnupg`,
  `${HOME}/.config/gcloud`,
  '/etc/shadow',
  '/etc/sudoers',
];

/** Paths where only writes are blocked (reads are fine). */
const DEFAULT_WRITE_BLOCKED_PATHS = ['/etc/passwd', '/etc/hosts'];

const WRITE_ACTION_TYPES = new Set(['file_write', 'file_delete', 'file_modify', 'file_create']);

export interface FsGuardOptions {
  /** Paths where ALL access is blocked (default: ~/.ssh, ~/.aws, etc.). */
  readBlockedPaths?: string[];
  /** Paths where only writes are blocked (default: /etc/passwd, /etc/hosts). */
  writeBlockedPaths?: string[];
  /** Legacy: treated as readBlockedPaths for backward compatibility. */
  blockedPaths?: string[];
  /** Resolved audit directory path to write-block. Defaults to resolveDataRoot()/audit. */
  auditPath?: string;
}

export class FsGuard implements Guard {
  readonly name = 'fs-guard';
  private readonly readBlockedPaths: string[];
  private readonly writeBlockedPaths: string[];

  constructor(options?: FsGuardOptions) {
    // Support legacy blockedPaths option
    const readPaths = options?.readBlockedPaths ?? options?.blockedPaths ?? DEFAULT_READ_BLOCKED_PATHS;
    const auditPath = options?.auditPath ?? join(resolveDataRoot(), 'audit');
    const writePaths = [...(options?.writeBlockedPaths ?? DEFAULT_WRITE_BLOCKED_PATHS), auditPath];

    this.readBlockedPaths = readPaths.map((p) => this.resolvePath(p));
    this.writeBlockedPaths = writePaths.map((p) => this.resolvePath(p));
  }

  check(action: ProposedAction): GuardResult {
    if (!action.path) return { pass: true };

    const normalized = this.normalizePath(action.path);
    const isWrite = WRITE_ACTION_TYPES.has(action.type);

    // Read-blocked paths: block ALL access (read + write)
    for (const blocked of this.readBlockedPaths) {
      if (this.pathMatches(normalized, blocked)) {
        return {
          pass: false,
          reason: `Path blocked (no access): ${action.path} (matches ${blocked})`,
        };
      }
    }

    // Write-blocked paths: only block writes
    if (isWrite) {
      for (const blocked of this.writeBlockedPaths) {
        if (this.pathMatches(normalized, blocked)) {
          return {
            pass: false,
            reason: `Path blocked (read-only): ${action.path} (matches ${blocked})`,
          };
        }
      }
    }

    return { pass: true };
  }

  private pathMatches(normalized: string, blocked: string): boolean {
    return normalized === blocked || normalized.startsWith(blocked + sep);
  }

  private normalizePath(p: string): string {
    let normalized = resolve(p);
    try {
      if (existsSync(normalized)) {
        normalized = realpathSync(normalized);
      }
    } catch {
      // If realpathSync fails, continue with resolved path
    }
    return normalized;
  }

  private resolvePath(p: string): string {
    const resolved = resolve(p);
    try {
      return existsSync(resolved) ? realpathSync(resolved) : resolved;
    } catch {
      return resolved;
    }
  }
}
