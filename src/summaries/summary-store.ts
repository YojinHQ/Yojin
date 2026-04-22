/**
 * Summary store — append-only JSONL storage for neutral intel observations.
 *
 * Summaries are read-only intel: no approval lifecycle, no mutations. They
 * are produced by macro + micro insight pipelines and consumed by the Intel
 * Feed and other display surfaces.
 *
 * Dedup: a summary with the same `contentHash` as an existing record
 * created within the last `dedupWindowMs` (default 24h) is silently skipped.
 * This lets both macro and micro write the same observation without
 * producing duplicate feed items.
 *
 * Storage layout:
 *   data/summaries/
 *     2026-04-11.jsonl
 *     2026-04-12.jsonl
 */

import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { Summary, SummaryFlow } from './types.js';
import { SummarySchema } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('summary-store');

const DEFAULT_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Strategy-layer fields that must NEVER appear on a Summary. Summaries are
 * neutral intel; any record carrying these fields is being written to the
 * wrong store (it belongs in `ActionStore`). Enforced at runtime as a
 * last-line-of-defence: the ESLint `no-restricted-imports` boundary rule in
 * `eslint.config.js` prevents `src/summaries/` from importing `src/strategies/`
 * or `src/actions/` in the first place.
 */
const FORBIDDEN_STRATEGY_FIELDS = ['strategyId', 'triggerId'] as const;

export interface SummaryStoreOptions {
  dir: string; // e.g. 'data/summaries'
  /** Dedup window in milliseconds. Defaults to 24 hours. */
  dedupWindowMs?: number;
}

interface SummaryQueryFilter {
  ticker?: string;
  /** Allowlist of tickers; when set, only summaries for these tickers are returned. */
  tickers?: readonly string[];
  flow?: SummaryFlow;
  since?: string; // ISO datetime
  limit?: number;
}

type SummaryResult<T> = { success: true; data: T } | { success: false; error: string };

export class SummaryStore {
  private readonly dir: string;
  private readonly dedupWindowMs: number;
  private dirCreated = false;

  constructor(options: SummaryStoreOptions) {
    this.dir = options.dir;
    this.dedupWindowMs = options.dedupWindowMs ?? DEFAULT_DEDUP_WINDOW_MS;
  }

  /**
   * Append a new summary. If a summary with the same contentHash already
   * exists within the dedup window, the new one is skipped and the existing
   * record is returned as the winner.
   */
  async create(summary: Summary): Promise<SummaryResult<Summary>> {
    // Runtime boundary check: reject any record carrying Strategy-layer
    // fields. Zod would normally strip unknown keys during parse, so this
    // must happen BEFORE safeParse to surface the architectural violation
    // instead of silently dropping the field.
    const record = summary as unknown as Record<string, unknown>;
    for (const field of FORBIDDEN_STRATEGY_FIELDS) {
      if (record[field] !== undefined) {
        const error =
          `Refusing to write Summary with '${field}' field — Summaries are neutral intel ` +
          `and must not carry Strategy-layer identifiers. Strategy-triggered records ` +
          `belong in ActionStore, not SummaryStore.`;
        logger.error('SummaryStore.create rejected Strategy-layer field', { field, id: record.id });
        return { success: false, error };
      }
    }

    const parsed = SummarySchema.safeParse(summary);
    if (!parsed.success) {
      return { success: false, error: `Invalid summary: ${parsed.error.message}` };
    }

    const existing = await this.findRecentByContentHash(parsed.data.contentHash);
    if (existing) {
      logger.debug('Summary deduped — matching contentHash within window', {
        contentHash: parsed.data.contentHash,
        existingId: existing.id,
      });
      return { success: true, data: existing };
    }

    await this.appendSummary(parsed.data);
    logger.info('Summary created', {
      id: parsed.data.id,
      ticker: parsed.data.ticker,
      flow: parsed.data.flow,
    });
    return { success: true, data: parsed.data };
  }

  /** Query summaries with optional filters. Returns newest first. */
  async query(filter: SummaryQueryFilter = {}): Promise<Summary[]> {
    const files = (await this.listFiles(filter.since)).reverse(); // newest first
    const results: Summary[] = [];
    const limit = filter.limit ?? 50;
    const normalizedTicker = filter.ticker?.toUpperCase();
    const tickerAllowlist = filter.tickers ? new Set(filter.tickers.map((t) => t.toUpperCase())) : null;

    for (const file of files) {
      if (results.length >= limit) break;

      const summaries = await this.readFile(file);
      for (const summary of [...summaries].reverse()) {
        if (results.length >= limit) break;
        if (normalizedTicker && summary.ticker.toUpperCase() !== normalizedTicker) continue;
        if (tickerAllowlist && !tickerAllowlist.has(summary.ticker.toUpperCase())) continue;
        if (filter.flow && summary.flow !== filter.flow) continue;
        if (filter.since && summary.createdAt < filter.since) continue;
        results.push(summary);
      }
    }

    return results;
  }

  /** Get a single summary by ID. */
  async getById(id: string): Promise<Summary | null> {
    const files = (await this.listFiles()).reverse();
    for (const file of files) {
      const summaries = await this.readFile(file);
      for (let i = summaries.length - 1; i >= 0; i--) {
        if (summaries[i].id === id) return summaries[i];
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Search recent files for a summary whose contentHash matches and whose
   * createdAt is within the dedup window. Used to prevent duplicate feed
   * entries when macro and micro both observe the same thing.
   */
  private async findRecentByContentHash(contentHash: string): Promise<Summary | null> {
    const cutoff = new Date(Date.now() - this.dedupWindowMs).toISOString();
    const files = (await this.listFiles(cutoff)).reverse();

    for (const file of files) {
      const summaries = await this.readFile(file);
      for (let i = summaries.length - 1; i >= 0; i--) {
        const candidate = summaries[i];
        if (candidate.contentHash !== contentHash) continue;
        if (candidate.createdAt < cutoff) return null; // older than the window
        return candidate;
      }
    }
    return null;
  }

  private async appendSummary(summary: Summary): Promise<void> {
    await this.ensureDir();
    const dateKey = summary.createdAt.slice(0, 10); // YYYY-MM-DD
    const filePath = join(this.dir, `${dateKey}.jsonl`);
    await appendFile(filePath, JSON.stringify(summary) + '\n');
  }

  private async listFiles(since?: string): Promise<string[]> {
    let dates: string[];
    try {
      const entries = await readdir(this.dir);
      dates = entries
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => f.replace('.jsonl', ''))
        .sort();
    } catch {
      return [];
    }

    if (since) {
      const sinceDate = since.slice(0, 10);
      dates = dates.filter((d) => d >= sinceDate);
    }

    return dates.map((d) => join(this.dir, `${d}.jsonl`));
  }

  /** Read a JSONL file. Invalid/legacy lines (e.g. Action records left over
   * before the split) are silently skipped. */
  private async readFile(filePath: string): Promise<Summary[]> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      const summaries: Summary[] = [];

      for (const line of lines) {
        try {
          const parsed = SummarySchema.safeParse(JSON.parse(line));
          if (parsed.success) {
            summaries.push(parsed.data);
          }
          // Legacy Action-shaped records are silently skipped — they'll be
          // migrated out by ActionStore.migrateFromSummaries on first access.
        } catch {
          // Malformed line — skip
        }
      }

      return summaries;
    } catch {
      return [];
    }
  }

  private async ensureDir(): Promise<void> {
    if (this.dirCreated) return;
    await mkdir(this.dir, { recursive: true });
    this.dirCreated = true;
  }
}
