/**
 * SupplyChainStore — per-ticker JSON storage for supply-chain maps.
 *
 * Each ticker gets its own file at `~/.yojin/supply-chain-maps/{SYMBOL}.json`.
 * Writes are atomic (temp file + rename) so readers never see a partial JSON.
 * Reads validate through `SupplyChainMapSchema` — malformed files return null
 * with a warning log (never throw).
 */

import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { SupplyChainMapSchema } from './supply-chain-types.js';
import type { SupplyChainMap } from './supply-chain-types.js';
import { createSubsystemLogger } from '../logging/logger.js';
import { resolveDataRoot } from '../paths.js';

const logger = createSubsystemLogger('supply-chain-store');

export class SupplyChainStore {
  private readonly dir: string;

  constructor(dataRoot: string = resolveDataRoot()) {
    this.dir = join(dataRoot, 'supply-chain-maps');
  }

  /** Read + validate a stored map. Returns null on ENOENT or parse failure. */
  async get(ticker: string): Promise<SupplyChainMap | null> {
    const filePath = this.filePath(ticker);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch (err) {
      if (isEnoent(err)) return null;
      logger.warn('Failed to read supply-chain map', { ticker, error: String(err) });
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      return SupplyChainMapSchema.parse(parsed);
    } catch (err) {
      logger.warn('Failed to parse supply-chain map', { ticker, error: String(err) });
      return null;
    }
  }

  /** Atomic write via temp file + rename. Creates the directory if missing. */
  async put(map: SupplyChainMap): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const target = this.filePath(map.ticker);
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(map, null, 2), 'utf-8');
    await rename(tmp, target);
  }

  /**
   * True if the stored map's local `asOf` is fresher than `maxAgeMs`.
   * Uses the map's own `asOf` (not the file mtime) so the freshness check
   * is tied to when the map was built, not when it was last touched.
   */
  async isFresh(ticker: string, maxAgeMs: number): Promise<boolean> {
    const map = await this.get(ticker);
    if (!map) return false;
    const asOfMs = Date.parse(map.asOf);
    if (!Number.isFinite(asOfMs)) return false;
    return Date.now() - asOfMs < maxAgeMs;
  }

  /** Returns the stored `dataAsOf` (max `source.asOf` across edges), or null. */
  async getDataAsOf(ticker: string): Promise<string | null> {
    const map = await this.get(ticker);
    return map?.dataAsOf ?? null;
  }

  /** Returns true if a file exists for the ticker. Useful for diagnostics. */
  async exists(ticker: string): Promise<boolean> {
    try {
      await stat(this.filePath(ticker));
      return true;
    } catch {
      return false;
    }
  }

  private filePath(ticker: string): string {
    return join(this.dir, `${ticker.toUpperCase()}.json`);
  }
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}
