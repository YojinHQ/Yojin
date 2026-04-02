/**
 * Brain — git-like versioned cognitive state for the Strategist agent.
 *
 * Every state change (frontal lobe update, emotion shift) creates a versioned
 * snapshot stored as JSONL in brain/commits.jsonl (relative to data root ~/.yojin/).
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile } from 'node:fs/promises';

import type { BrainCommit, Brain as BrainInterface } from './types.js';
import { BrainCommitSchema } from './types.js';
import { createSafeLogger } from '../logging/logger.js';

const logger = createSafeLogger('brain');

const BRAIN_DIR = 'brain';
const COMMITS_FILE = `${BRAIN_DIR}/commits.jsonl`;

function computeHash(content: string, timestamp: string): string {
  return createHash('sha256').update(`${content}\0${timestamp}`).digest('hex').slice(0, 12);
}

export class BrainStore implements BrainInterface {
  private readonly brainDir: string;
  private readonly commitsFile: string;

  constructor(dataRoot = '.') {
    this.brainDir = `${dataRoot}/${BRAIN_DIR}`;
    this.commitsFile = `${dataRoot}/${COMMITS_FILE}`;
  }

  private async ensureDir(): Promise<void> {
    if (!existsSync(this.brainDir)) {
      await mkdir(this.brainDir, { recursive: true });
    }
  }

  async commit(message: string, type: BrainCommit['type'], snapshot: Record<string, unknown>): Promise<BrainCommit> {
    await this.ensureDir();

    const timestamp = new Date().toISOString();
    const hash = computeHash(`${JSON.stringify(snapshot)}\0${message}`, timestamp);

    const entry: BrainCommit = { hash, message, timestamp, type, snapshot };
    BrainCommitSchema.parse(entry);

    await appendFile(this.commitsFile, JSON.stringify(entry) + '\n', 'utf-8');
    logger.info('Brain commit', { hash, type, message });
    return entry;
  }

  async getLog(limit = 50): Promise<BrainCommit[]> {
    if (!existsSync(this.commitsFile)) return [];

    const raw = await readFile(this.commitsFile, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);

    const commits: BrainCommit[] = [];
    for (const line of lines) {
      try {
        const parsed = BrainCommitSchema.safeParse(JSON.parse(line));
        if (parsed.success) commits.push(parsed.data);
      } catch {
        // skip malformed lines caused by interrupted writes
      }
    }

    return commits.reverse().slice(0, limit);
  }

  async rollback(hash: string): Promise<BrainCommit | null> {
    const log = await this.getLog(Number.MAX_SAFE_INTEGER);
    const target = log.find((c) => c.hash === hash);
    if (!target) {
      logger.warn('Rollback target not found', { hash });
      return null;
    }

    const result = await this.commit(`rollback to ${hash}: ${target.message}`, target.type, target.snapshot);
    logger.info('Rolling back brain state', { targetHash: hash, targetMessage: target.message });
    return result;
  }
}
