/**
 * SnapStore — file-based persistence for the latest Strategist snap brief.
 *
 * Stores only the latest snap in `data/snap/latest.json`.
 * Follows the file-driven state pattern used by other stores.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { Snap } from './types.js';
import { SnapSchema } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('snap-store');

export class SnapStore {
  private readonly filePath: string;

  constructor(dataRoot: string) {
    this.filePath = join(dataRoot, 'snap', 'latest.json');
  }

  /** Read the latest snap. Returns null if no snap exists yet. */
  async getLatest(): Promise<Snap | null> {
    let content: string;
    try {
      content = await readFile(this.filePath, 'utf-8');
    } catch {
      return null;
    }

    try {
      return SnapSchema.parse(JSON.parse(content));
    } catch (err) {
      logger.warn('Failed to parse snap file', { error: String(err) });
      return null;
    }
  }

  /** Save a snap, overwriting the previous one. */
  async save(snap: Snap): Promise<void> {
    const validated = SnapSchema.parse(snap);
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(validated, null, 2) + '\n');
    logger.info('Snap saved', {
      id: validated.id,
      actionItems: validated.actionItems.length,
    });
  }
}
