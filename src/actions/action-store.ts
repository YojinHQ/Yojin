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
 * No cross-strategy conflict resolution: multiple strategies can produce
 * competing PENDING actions for the same ticker. The user decides which to act on.
 *
 * Storage layout:
 *   data/actions/
 *     2026-04-11.jsonl
 *     2026-04-12.jsonl
 */

import { appendFile, mkdir, readFile, readdir, rename, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { Action, ActionStatus } from './types.js';
import { ActionSchema } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';
import type { TriggerStrength } from '../strategies/trigger-strength.js';
import { STRENGTH_ORDER } from '../strategies/trigger-strength.js';

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
  /** Per-triggerId mutex to serialize supersede+append in create(). */
  private readonly triggerLocks = new Map<string, Promise<void>>();

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

    // Serialize per triggerId so concurrent creates can't both observe the same
    // snapshot and each append a PENDING record (read-modify-write race).
    const { triggerId } = parsed.data;
    const prev = this.triggerLocks.get(triggerId) ?? Promise.resolve();
    const settled = prev.then(async () => {
      const allActions = await this.queryAll();
      await this.supersedePendingByTriggerId(triggerId, allActions);
      await this.appendAction(parsed.data);
    });
    // Store a swallowed-error version so a rejected promise doesn't block the next caller.
    const queued = settled.catch(() => {});
    this.triggerLocks.set(triggerId, queued);
    try {
      await settled;
    } finally {
      // Clean up only if no subsequent create has chained onto this key.
      if (this.triggerLocks.get(triggerId) === queued) {
        this.triggerLocks.delete(triggerId);
      }
    }

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

  /**
   * Batch-check which triggerIds were recently resolved (APPROVED/REJECTED).
   * Returns Map<triggerId, resolvedAction> for entries whose new strength does
   * NOT exceed the resolved strength — callers should skip these. Entries with
   * escalated strength are excluded (absent from the map) so the caller fires.
   */
  async getRecentResolutions(
    entries: ReadonlyArray<{ triggerId: string; newStrength: TriggerStrength }>,
    windowMs: number,
  ): Promise<Map<string, Action>> {
    if (entries.length === 0) return new Map();

    const cutoff = new Date(Date.now() - windowMs).toISOString();
    const files = (await this.listFiles()).reverse();
    const triggerIds = new Set(entries.map((e) => e.triggerId));

    // Build a map of triggerId → latest resolved action within the cutoff window.
    const latestByTrigger = new Map<string, Action>();
    for (const file of files) {
      const actions = await this.readFile(file);
      for (const action of actions) {
        if (!triggerIds.has(action.triggerId)) continue;
        if (action.status !== 'APPROVED' && action.status !== 'REJECTED') continue;
        if (!action.resolvedAt || action.resolvedAt < cutoff) continue;
        const existing = latestByTrigger.get(action.triggerId);
        if (!existing || action.resolvedAt > (existing.resolvedAt ?? '')) {
          latestByTrigger.set(action.triggerId, action);
        }
      }
    }

    // Exclude entries whose new strength escalates past the resolved strength.
    const result = new Map<string, Action>();
    for (const { triggerId, newStrength } of entries) {
      const resolved = latestByTrigger.get(triggerId);
      if (!resolved) continue;
      if (STRENGTH_ORDER[newStrength] > STRENGTH_ORDER[resolved.triggerStrength]) continue;
      result.set(triggerId, resolved);
    }

    return result;
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
