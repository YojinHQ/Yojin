/**
 * SupplyChainExpansionStore — per-expansion JSON cache for progressive
 * supply-chain graph expansions.
 *
 * Each expansion is keyed by SHA-1 of `sourceNodeId | direction | hopDepth` and
 * stored at `~/.yojin/supply-chain-expansions/<key>.json`. Writes are atomic
 * (temp file + rename). Reads validate through `SupplyChainExpansionSchema` —
 * malformed files return null with a warning log (never throw).
 *
 * Mirrors the pattern of `SupplyChainStore` (per-key JSON, atomic writes,
 * schema-validated reads). Re-clicking the same direction chip from the same
 * node is free on the cache hit path.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SupplyChainDirection, SupplyChainExpansion } from './supply-chain-types.js';
import { SupplyChainExpansionSchema } from './supply-chain-types.js';
import { createSubsystemLogger } from '../logging/logger.js';
import { resolveDataRoot } from '../paths.js';

const logger = createSubsystemLogger('supply-chain-expansion-store');

export interface ExpansionKeyArgs {
  sourceNodeId: string;
  direction: SupplyChainDirection;
  hopDepth: number;
}

export function expansionCacheKey(args: ExpansionKeyArgs): string {
  const raw = `${args.sourceNodeId}|${args.direction}|${args.hopDepth}`;
  return createHash('sha1').update(raw).digest('hex');
}

export class SupplyChainExpansionStore {
  private readonly dir: string;

  constructor(dataRoot: string = resolveDataRoot()) {
    this.dir = join(dataRoot, 'supply-chain-expansions');
  }

  /** Read + validate a stored expansion. Returns null on ENOENT or parse failure. */
  async get(key: string): Promise<SupplyChainExpansion | null> {
    const filePath = this.filePath(key);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch (err) {
      if (isEnoent(err)) return null;
      logger.warn('Failed to read supply-chain expansion', { key, error: String(err) });
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      return SupplyChainExpansionSchema.parse(parsed);
    } catch (err) {
      logger.warn('Failed to parse supply-chain expansion', { key, error: String(err) });
      return null;
    }
  }

  /** Atomic write via temp file + rename. Creates the directory if missing. */
  async put(key: string, expansion: SupplyChainExpansion): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const target = this.filePath(key);
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(expansion, null, 2), 'utf-8');
    await rename(tmp, target);
  }

  /**
   * True if the stored expansion's `expandedAt` is fresher than `maxAgeMs`.
   * Uses the record's own timestamp (not the file mtime) so freshness is tied
   * to when the LLM pass ran, not when the file was last touched.
   */
  async isFresh(key: string, maxAgeMs: number): Promise<boolean> {
    const expansion = await this.get(key);
    if (!expansion) return false;
    const ts = Date.parse(expansion.expandedAt);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < maxAgeMs;
  }

  /** Returns true if a file exists for the key. Useful for diagnostics / tests. */
  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.filePath(key));
      return true;
    } catch {
      return false;
    }
  }

  private filePath(key: string): string {
    return join(this.dir, `${key}.json`);
  }
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}
