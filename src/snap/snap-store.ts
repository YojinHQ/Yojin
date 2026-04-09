/**
 * SnapStore — file-based persistence for the latest Strategist snap brief.
 *
 * Stores one snap per scope in `data/snap/<scope>-latest.json`
 * (`portfolio-latest.json` for portfolio-held assets, `watchlist-latest.json`
 * for watchlist-only assets). Keeps each scope's brief isolated so the
 * watchlist page never displays portfolio chatter and vice versa.
 *
 * Back-compat: if the legacy `latest.json` exists and nothing has been
 * written to `portfolio-latest.json` yet, `getLatest('portfolio')` falls
 * back to it so existing installs keep rendering their last brief.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Snap, SnapScope } from './types.js';
import { SnapSchema } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('snap-store');

export class SnapStore {
  private readonly dir: string;

  constructor(dataRoot: string) {
    this.dir = join(dataRoot, 'snap');
  }

  /** Read the latest snap for a given scope. Returns null if none exists. */
  async getLatest(scope: SnapScope): Promise<Snap | null> {
    const scoped = await this.readSnapFile(this.filePath(scope));
    if (scoped) return scoped;

    // Back-compat: portfolio scope falls back to the pre-scope legacy file.
    if (scope === 'portfolio') {
      const legacy = await this.readSnapFile(join(this.dir, 'latest.json'));
      if (legacy) return { ...legacy, scope: 'portfolio' };
    }
    return null;
  }

  /** Save a snap for the scope embedded in `snap.scope`, overwriting the previous one. */
  async save(snap: Snap): Promise<void> {
    const validated = SnapSchema.parse(snap);
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.filePath(validated.scope), JSON.stringify(validated, null, 2) + '\n');
    logger.info('Snap saved', {
      id: validated.id,
      scope: validated.scope,
      actionItems: validated.actionItems.length,
    });
  }

  private filePath(scope: SnapScope): string {
    return join(this.dir, `${scope}-latest.json`);
  }

  private async readSnapFile(path: string): Promise<Snap | null> {
    let content: string;
    try {
      content = await readFile(path, 'utf-8');
    } catch {
      return null;
    }
    try {
      return SnapSchema.parse(JSON.parse(content));
    } catch (err) {
      logger.warn('Failed to parse snap file', { path, error: String(err) });
      return null;
    }
  }
}
