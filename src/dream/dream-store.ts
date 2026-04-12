/**
 * DreamStore — append-only JSONL log of dream runs.
 *
 * Each dream run appends a DreamLog entry so the system (and the user)
 * can see what was cleaned, what was flagged stale, and when.
 *
 * Also tracks the last-run timestamp for gating the next dream.
 */

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { DreamLog } from './types.js';
import { DreamLogSchema } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('dream-store');

const LOG_FILE = 'dream-log.jsonl';
const LAST_RUN_FILE = 'last-run.json';

export class DreamStore {
  private readonly dir: string;

  constructor(dataRoot: string) {
    this.dir = join(dataRoot, 'dream');
  }

  /** Append a validated dream log entry. */
  async save(log: DreamLog): Promise<void> {
    const validated = DreamLogSchema.parse(log);
    await mkdir(this.dir, { recursive: true });
    await appendFile(join(this.dir, LOG_FILE), JSON.stringify(validated) + '\n');
    // Update the last-run marker
    await writeFile(join(this.dir, LAST_RUN_FILE), JSON.stringify({ lastRunAt: validated.completedAt }));
    logger.info('Dream log saved', { id: validated.id, durationMs: validated.durationMs });
  }

  /** Read the most recent N dream logs, newest first. */
  async getRecent(limit: number): Promise<DreamLog[]> {
    const lines = await this.readLines();
    const logs: DreamLog[] = [];
    for (const line of lines) {
      try {
        logs.push(DreamLogSchema.parse(JSON.parse(line)));
      } catch {
        logger.warn('Skipping malformed dream log line');
      }
    }
    return logs.slice(-limit).reverse();
  }

  /** Timestamp of the last completed dream run. Returns 0 if never run. */
  async getLastRunAt(): Promise<number> {
    try {
      const content = await readFile(join(this.dir, LAST_RUN_FILE), 'utf-8');
      const data = JSON.parse(content) as { lastRunAt?: string };
      if (data.lastRunAt) return new Date(data.lastRunAt).getTime();
    } catch {
      // No last-run file — first run
    }
    return 0;
  }

  private async readLines(): Promise<string[]> {
    let content: string;
    try {
      content = await readFile(join(this.dir, LOG_FILE), 'utf-8');
    } catch {
      return [];
    }
    return content.trim().split('\n').filter(Boolean);
  }
}
