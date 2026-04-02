/**
 * Emotion — Strategist's confidence level and risk appetite.
 *
 * Each emotion state includes a reason explaining why it changed
 * (e.g., "VIX spike to 35 → lowered confidence"). Stored as JSON
 * at brain/emotion.json (relative to data root ~/.yojin/), auto-commits on every update.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { BrainStore } from './brain.js';
import type { BrainCommit, EmotionState, EmotionTracker as EmotionTrackerInterface } from './types.js';
import { EmotionStateSchema, createDefaultEmotion } from './types.js';
import { createSafeLogger } from '../logging/logger.js';

const logger = createSafeLogger('brain/emotion');

const EMOTION_FILE = 'brain/emotion.json';

export class EmotionTracker implements EmotionTrackerInterface {
  private readonly filePath: string;
  private readonly brain: BrainStore;

  constructor(brain: BrainStore, dataRoot = '.') {
    this.brain = brain;
    this.filePath = `${dataRoot}/${EMOTION_FILE}`;
  }

  async getEmotion(): Promise<EmotionState> {
    if (!existsSync(this.filePath)) return createDefaultEmotion();

    try {
      const raw = await readFile(this.filePath, 'utf-8');
      const parsed = EmotionStateSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : createDefaultEmotion();
    } catch {
      return createDefaultEmotion();
    }
  }

  async updateEmotion(state: Omit<EmotionState, 'updatedAt'>, reason?: string): Promise<BrainCommit> {
    const previous = await this.getEmotion();
    const updated: EmotionState = {
      confidence: state.confidence,
      riskAppetite: state.riskAppetite,
      reason: reason ?? state.reason,
      updatedAt: new Date().toISOString(),
    };

    EmotionStateSchema.parse(updated);

    const delta = [
      previous.confidence !== updated.confidence
        ? `confidence ${previous.confidence.toFixed(2)} → ${updated.confidence.toFixed(2)}`
        : null,
      previous.riskAppetite !== updated.riskAppetite
        ? `risk appetite ${previous.riskAppetite.toFixed(2)} → ${updated.riskAppetite.toFixed(2)}`
        : null,
    ]
      .filter(Boolean)
      .join(', ');

    // Commit first — if this fails, the file is not yet touched
    const commitResult = await this.brain.commit(delta || 'emotion state refreshed', 'emotion', {
      previous,
      updated,
    });

    const dir = dirname(this.filePath);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await writeFile(this.filePath, JSON.stringify(updated, null, 2), 'utf-8');
    logger.info('Emotion updated', {
      confidence: updated.confidence,
      riskAppetite: updated.riskAppetite,
      reason: updated.reason,
    });

    return commitResult;
  }
}
