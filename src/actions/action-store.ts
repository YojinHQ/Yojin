/**
 * Action store — append-only JSONL storage with date-partitioned files.
 *
 * Stores Actions (PENDING -> APPROVED | REJECTED | EXPIRED). Updates are
 * appended as new lines — the highest-version entry for each ID wins on read.
 *
 * Supersede-on-triggerId: when a fresh evaluation arrives for a triggerId that
 * already has a PENDING record, the old record is marked EXPIRED with
 * `resolvedBy: 'superseded'` and the new record is appended. This lets later
 * flows (e.g. macro refining a micro-fired trigger) update the Action instead
 * of being silently skipped.
 *
 * Storage layout:
 *   data/actions/
 *     2026-04-11.jsonl
 *     2026-04-12.jsonl
 */

import { appendFile, mkdir, readFile, readdir, rename, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { Action, ActionStatus, ActionVerdict } from './types.js';
import { ActionSchema, effectiveScore } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('action-store');

export interface ActionStoreOptions {
  dir: string; // e.g. 'data/actions'
}

interface ActionQueryFilter {
  status?: ActionStatus;
  since?: string; // ISO date string
  limit?: number;
  dismissed?: boolean;
}

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

export class ActionStore {
  private readonly dir: string;
  private dirCreated = false;
  private migrationDone = false;

  constructor(options: ActionStoreOptions) {
    this.dir = options.dir;
  }

  /**
   * Migrate legacy Action-shaped records out of data/summaries/ into data/actions/.
   *
   * Historically, Actions (strategy-triggered records) were stored in the same
   * JSONL files as Summaries. We now split them — this migration walks every
   * file under data/summaries/ and moves records that have a `strategyId` field
   * into a parallel file under data/actions/. Records without `strategyId` are
   * left in place for the new SummaryStore.
   *
   * Safe to call multiple times — skips if already done.
   */
  private async migrateFromSummaries(): Promise<void> {
    if (this.migrationDone) return;
    this.migrationDone = true;

    const legacyDir = join(dirname(this.dir), 'summaries');
    try {
      await stat(legacyDir);
    } catch {
      return; // no legacy dir — nothing to migrate
    }

    await this.ensureDir();

    let fileCount = 0;
    let recordCount = 0;
    try {
      const entries = await readdir(legacyDir);
      for (const entry of entries) {
        if (!entry.endsWith('.jsonl')) continue;
        const legacyPath = join(legacyDir, entry);
        let content: string;
        try {
          content = await readFile(legacyPath, 'utf-8');
        } catch {
          continue;
        }
        const lines = content.split('\n').filter(Boolean);
        const actionLines: string[] = [];
        const summaryLines: string[] = [];
        let sawAction = false;

        for (const line of lines) {
          try {
            const obj = JSON.parse(line) as Record<string, unknown>;
            if (typeof obj.strategyId === 'string' && obj.strategyId.length > 0) {
              sawAction = true;
              actionLines.push(line);
            } else {
              summaryLines.push(line);
            }
          } catch {
            // Keep malformed lines in the legacy file
            summaryLines.push(line);
          }
        }

        if (!sawAction) continue;

        // Append migrated Actions to the corresponding file in data/actions/
        const destPath = join(this.dir, entry);
        await appendFile(destPath, actionLines.join('\n') + '\n');
        recordCount += actionLines.length;
        fileCount++;

        // Rewrite the legacy file without the migrated Actions.
        // Use a temp file + rename to avoid partial writes.
        const { writeFile } = await import('node:fs/promises');
        const tmpPath = `${legacyPath}.migrating`;
        await writeFile(tmpPath, summaryLines.length > 0 ? summaryLines.join('\n') + '\n' : '');
        await rename(tmpPath, legacyPath);
      }
      if (fileCount > 0) {
        logger.info(`Migrated ${recordCount} action record(s) from ${fileCount} summaries file(s)`);
      }
    } catch (err) {
      logger.warn('Failed to migrate legacy summaries', { error: String(err) });
    }
  }

  /**
   * Create a new Action, superseding any existing PENDING record with the same
   * triggerId. This ensures fresh evaluations (e.g. macro refining a micro
   * trigger) replace stale ones rather than being skipped.
   */
  async create(action: Action): Promise<ActionResult<Action>> {
    const parsed = ActionSchema.safeParse(action);
    if (!parsed.success) {
      return { success: false, error: `Invalid action: ${parsed.error.message}` };
    }

    const allActions = await this.queryAll();
    await this.supersedePendingByTriggerId(parsed.data.triggerId, allActions);

    const kept = await this.resolveTickerConflicts(parsed.data, allActions);
    if (!kept) {
      const now = new Date().toISOString();
      const expired: Action = {
        ...parsed.data,
        status: 'EXPIRED',
        resolvedAt: now,
        resolvedBy: 'conflict',
      };
      await this.appendAction(expired);
      logger.info('Action conflict-expired on create (lower effective score)', {
        id: parsed.data.id,
        verdict: parsed.data.verdict,
      });
      return { success: true, data: expired };
    }

    await this.appendAction(parsed.data);
    logger.info('Action created', {
      id: parsed.data.id,
      strategyId: parsed.data.strategyId,
      verdict: parsed.data.verdict,
    });
    return { success: true, data: parsed.data };
  }

  /** Approve a pending action. Appends updated version (append-only). */
  async approve(id: string): Promise<ActionResult<Action>> {
    return this.resolve(id, 'APPROVED', 'user');
  }

  /** Reject a pending action. Appends updated version (append-only). */
  async reject(id: string): Promise<ActionResult<Action>> {
    return this.resolve(id, 'REJECTED', 'user');
  }

  /** Dismiss a pending action (soft-hide without changing status). */
  async dismiss(id: string): Promise<ActionResult<Action>> {
    const existing = await this.getById(id);
    if (!existing) {
      return { success: false, error: `Action not found: ${id}` };
    }
    if (existing.dismissedAt) {
      return { success: false, error: `Action ${id} is already dismissed` };
    }
    if (existing.status !== 'PENDING') {
      return { success: false, error: `Action ${id} is already ${existing.status}, cannot dismiss` };
    }
    const now = new Date().toISOString();
    if (existing.expiresAt <= now) {
      const expired: Action = { ...existing, status: 'EXPIRED', resolvedAt: now, resolvedBy: 'timeout' };
      await this.appendAction(expired);
      return { success: false, error: `Action ${id} has expired` };
    }
    const updated: Action = { ...existing, dismissedAt: now };
    await this.appendAction(updated);
    logger.info('Action dismissed', { id });
    return { success: true, data: updated };
  }

  /** Get all pending actions, auto-expiring those past expiresAt. */
  async getPending(): Promise<Action[]> {
    const all = await this.queryAll();
    const now = new Date().toISOString();
    const pending: Action[] = [];

    for (const action of all) {
      if (action.status !== 'PENDING') continue;
      if (action.dismissedAt) continue;

      if (action.expiresAt <= now) {
        const expired: Action = {
          ...action,
          status: 'EXPIRED',
          resolvedAt: now,
          resolvedBy: 'timeout',
        };
        await this.appendAction(expired);
        logger.info('Action auto-expired', { id: action.id });
      } else {
        pending.push(action);
      }
    }

    return pending;
  }

  /** Find a single action by ID (returns latest version). */
  async getById(id: string): Promise<Action | null> {
    const files = (await this.listFiles()).reverse(); // newest first

    for (const file of files) {
      const actions = await this.readFile(file);
      for (let i = actions.length - 1; i >= 0; i--) {
        if (actions[i].id === id) return actions[i];
      }
    }

    return null;
  }

  /** Query actions with optional filters. */
  async query(filter: ActionQueryFilter = {}): Promise<Action[]> {
    const files = (await this.listFiles(filter.since)).reverse(); // newest first
    const results: Action[] = [];
    const limit = filter.limit ?? 50;
    const now = new Date().toISOString();

    for (const file of files) {
      if (results.length >= limit) break;

      const actions = await this.readFile(file);
      for (const action of [...actions].reverse()) {
        if (results.length >= limit) break;

        const effectiveStatus = action.status === 'PENDING' && action.expiresAt <= now ? 'EXPIRED' : action.status;

        if (filter.status && effectiveStatus !== filter.status) continue;

        if (filter.dismissed === true && !action.dismissedAt) continue;
        if (filter.dismissed !== true && action.dismissedAt) continue;

        if (effectiveStatus !== action.status) {
          results.push({ ...action, status: effectiveStatus as ActionStatus });
        } else {
          results.push(action);
        }
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Mark every PENDING (non-expired, non-dismissed) record sharing this
   * triggerId as EXPIRED with resolvedBy='superseded'. Called just before
   * appending a fresh Action to ensure the triggerId dedup guarantees that
   * at most one PENDING record exists per triggerId at a time.
   */
  private async supersedePendingByTriggerId(triggerId: string, all?: Action[]): Promise<void> {
    const actions = all ?? (await this.queryAll());
    const now = new Date().toISOString();

    for (const existing of actions) {
      if (existing.triggerId !== triggerId) continue;
      if (existing.status !== 'PENDING') continue;
      if (existing.dismissedAt) continue;
      if (existing.expiresAt <= now) continue;

      const superseded: Action = {
        ...existing,
        status: 'EXPIRED',
        resolvedAt: now,
        resolvedBy: 'superseded',
      };
      await this.appendAction(superseded);
      logger.debug('Action superseded by fresh trigger', {
        id: existing.id,
        triggerId,
      });
    }
  }

  /**
   * Cross-strategy ticker conflict resolution. When a new action targets the
   * same ticker as an existing PENDING action, the one with the higher effective
   * score wins. Returns true if the new action should be kept, false if it lost.
   */
  private async resolveTickerConflicts(newAction: Action, all?: Action[]): Promise<boolean> {
    if (newAction.tickers.length === 0) return true;

    const newTickers = new Set(newAction.tickers);
    const newScore = effectiveScore(newAction.confidence, newAction.verdict as ActionVerdict);
    const actions = all ?? (await this.queryAll());
    const now = new Date().toISOString();

    // Collect all overlapping pending actions first (skip same-triggerId — handled by supersede)
    const overlapping: Action[] = [];
    for (const existing of actions) {
      if (existing.id === newAction.id) continue;
      if (existing.triggerId === newAction.triggerId) continue;
      if (existing.status !== 'PENDING') continue;
      if (existing.dismissedAt) continue;
      if (existing.expiresAt <= now) continue;

      const overlaps = existing.tickers.some((t) => newTickers.has(t));
      if (!overlaps) continue;

      overlapping.push(existing);
    }

    // Check if new action beats ALL overlapping actions before mutating
    for (const existing of overlapping) {
      const existingScore = effectiveScore(existing.confidence, existing.verdict as ActionVerdict);
      if (newScore < existingScore) {
        return false;
      }
    }

    // New action wins — expire all overlapping actions
    for (const existing of overlapping) {
      const expired: Action = {
        ...existing,
        status: 'EXPIRED',
        resolvedAt: now,
        resolvedBy: 'conflict',
      };
      await this.appendAction(expired);
      logger.debug('Existing action conflict-expired by new action', {
        existingId: existing.id,
        newId: newAction.id,
      });
    }

    return true;
  }

  private async resolve(
    id: string,
    status: 'APPROVED' | 'REJECTED',
    resolvedBy: string,
  ): Promise<ActionResult<Action>> {
    const existing = await this.getById(id);
    if (!existing) {
      return { success: false, error: `Action not found: ${id}` };
    }

    if (existing.status !== 'PENDING') {
      return {
        success: false,
        error: `Action ${id} is already ${existing.status}, cannot ${status.toLowerCase()}`,
      };
    }

    const now = new Date().toISOString();
    if (existing.expiresAt <= now) {
      const expired: Action = {
        ...existing,
        status: 'EXPIRED',
        resolvedAt: now,
        resolvedBy: 'timeout',
      };
      await this.appendAction(expired);
      return { success: false, error: `Action ${id} has expired` };
    }

    const updated: Action = {
      ...existing,
      status,
      resolvedAt: now,
      resolvedBy,
    };
    await this.appendAction(updated);
    logger.info(`Action ${status.toLowerCase()}`, { id });
    return { success: true, data: updated };
  }

  /** Append an action line to the appropriate date-partitioned file. */
  private async appendAction(action: Action): Promise<void> {
    await this.ensureDir();
    const dateKey = action.createdAt.slice(0, 10); // YYYY-MM-DD
    const filePath = join(this.dir, `${dateKey}.jsonl`);
    await appendFile(filePath, JSON.stringify(action) + '\n');
  }

  /**
   * Read all actions from all files, deduplicating by ID (last write wins).
   * Used internally for getPending which needs the full picture.
   */
  private async queryAll(): Promise<Action[]> {
    const files = await this.listFiles();
    const byId = new Map<string, Action>();

    for (const file of files) {
      const actions = await this.readFile(file);
      for (const action of actions) {
        byId.set(action.id, action); // last write wins
      }
    }

    return [...byId.values()];
  }

  private async listFiles(since?: string): Promise<string[]> {
    await this.migrateFromSummaries();
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

  /**
   * Read a JSONL file and deduplicate by ID (last entry wins).
   * This handles the append-only update model: when an action is
   * approved/rejected/expired/superseded, its updated version is appended.
   */
  private async readFile(filePath: string): Promise<Action[]> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      const byId = new Map<string, Action>();

      for (let i = 0; i < lines.length; i++) {
        try {
          const parsed = ActionSchema.safeParse(JSON.parse(lines[i]));
          if (parsed.success) {
            byId.set(parsed.data.id, parsed.data); // last write wins
          } else {
            logger.warn(`Skipping invalid action at ${filePath}:${i}: ${parsed.error.message}`);
          }
        } catch {
          logger.warn(`Skipping malformed action at ${filePath}:${i}`);
        }
      }

      return [...byId.values()];
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
