/**
 * Frontal Lobe — Strategist's working memory.
 *
 * Current hypotheses, observations, and active reasoning chains stored
 * as Markdown at data/brain/frontal-lobe.md. Auto-commits on every update.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { BrainStore } from './brain.js';
import type { BrainCommit, FrontalLobe as FrontalLobeInterface } from './types.js';

const FRONTAL_LOBE_FILE = 'data/brain/frontal-lobe.md';

const DEFAULT_CONTENT = `# Working Memory

No active reasoning chains yet. Awaiting first portfolio analysis.
`;

export class FrontalLobe implements FrontalLobeInterface {
  private readonly filePath: string;
  private readonly brain: BrainStore;

  constructor(brain: BrainStore, dataRoot = '.') {
    this.brain = brain;
    this.filePath = `${dataRoot}/${FRONTAL_LOBE_FILE}`;
  }

  async get(): Promise<string> {
    if (!existsSync(this.filePath)) return DEFAULT_CONTENT;
    return readFile(this.filePath, 'utf-8');
  }

  async update(content: string): Promise<BrainCommit> {
    const previous = await this.get();
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await writeFile(this.filePath, content, 'utf-8');

    const diffSummary =
      previous === DEFAULT_CONTENT
        ? 'initial working memory'
        : `updated working memory (${content.length} chars)`;

    return this.brain.commit(diffSummary, 'frontal-lobe', {
      content,
      previousLength: previous.length,
    });
  }
}
