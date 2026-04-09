/**
 * Action store — append-only JSONL storage with date-partitioned files.
 *
 * Stores Actions that require human approval (PENDING -> APPROVED | REJECTED | EXPIRED).
 * Updates are appended as new lines — the highest-version entry for each ID wins on read.
 *
 * Storage layout:
 *   data/actions/
 *     2026-03-21.jsonl
 *     2026-03-22.jsonl
 */

import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { Action, ActionStatus } from './types.js';
import { ActionSchema } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('action-store');

export interface ActionStoreOptions {
  dir: string; // e.g. 'data/actions'
}

interface ActionQueryFilter {
  status?: ActionStatus;
  since?: string; // ISO date string
  limit?: number;
}

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

export class ActionStore {
  private readonly dir: string;
  private dirCreated = false;

  constructor(options: ActionStoreOptions) {
    this.dir = options.dir;
  }

  /** Create a new action and append it to the date-partitioned store. */
  async create(action: Action): Promise<ActionResult<Action>> {
    const parsed = ActionSchema.safeParse(action);
    if (!parsed.success) {
      return { success: false, error: `Invalid action: ${parsed.error.message}` };
    }

    await this.appendAction(parsed.data);
    logger.info('Action created', { id: parsed.data.id, source: parsed.data.source });
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

  /**
   * Supersede a pending action — marked EXPIRED with resolvedBy='superseded'.
   * Used when a higher-priority action replaces an older one for the same ticker.
   */
  async supersede(id: string): Promise<ActionResult<Action>> {
    const existing = await this.getById(id);
    if (!existing) {
      return { success: false, error: `Action not found: ${id}` };
    }
    if (existing.status !== 'PENDING') {
      return {
        success: false,
        error: `Action ${id} is already ${existing.status}, cannot supersede`,
      };
    }

    const updated: Action = {
      ...existing,
      status: 'EXPIRED',
      resolvedAt: new Date().toISOString(),
      resolvedBy: 'superseded',
    };
    await this.appendAction(updated);
    logger.info('Action superseded', { id });
    return { success: true, data: updated };
  }

  /** Get all pending actions, auto-expiring those past expiresAt. */
  async getPending(): Promise<Action[]> {
    const all = await this.queryAll();
    const now = new Date().toISOString();
    const pending: Action[] = [];

    for (const action of all) {
      if (action.status !== 'PENDING') continue;

      if (action.expiresAt <= now) {
        // Auto-expire
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
      // Search in reverse for the latest entry with this ID
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

        // Resolve effective status (auto-expire check)
        const effectiveStatus = action.status === 'PENDING' && action.expiresAt <= now ? 'EXPIRED' : action.status;

        if (filter.status && effectiveStatus !== filter.status) continue;

        // Return with effective status
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

    // Check expiry
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
   * approved/rejected/expired, its updated version is appended.
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
