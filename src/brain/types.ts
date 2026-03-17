/**
 * Brain types — Strategist's persistent cognitive state.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Commit (versioned state snapshot)
// ---------------------------------------------------------------------------

export const BrainCommitSchema = z.object({
  hash: z.string(),
  message: z.string(),
  timestamp: z.string().datetime(),
  type: z.enum(['frontal-lobe', 'emotion', 'persona', 'manual']),
  snapshot: z.record(z.unknown()),
});

export type BrainCommit = z.infer<typeof BrainCommitSchema>;

// ---------------------------------------------------------------------------
// Emotion state
// ---------------------------------------------------------------------------

export const EmotionStateSchema = z.object({
  confidence: z.number().min(0).max(1),
  riskAppetite: z.number().min(0).max(1),
  reason: z.string(),
  updatedAt: z.string().datetime(),
});

export type EmotionState = z.infer<typeof EmotionStateSchema>;

/** Base defaults — callers must supply a fresh `updatedAt` via spread + override. */
export const DEFAULT_EMOTION_VALUES = {
  confidence: 0.5,
  riskAppetite: 0.5,
  reason: 'Initial state — no market data processed yet.',
} as const;

export function createDefaultEmotion(): EmotionState {
  return { ...DEFAULT_EMOTION_VALUES, updatedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Brain interface
// ---------------------------------------------------------------------------

export interface Brain {
  /** Create a versioned snapshot of the current state. */
  commit(
    message: string,
    type: BrainCommit['type'],
    snapshot: Record<string, unknown>,
  ): Promise<BrainCommit>;

  /** Get ordered commit history (newest first). */
  getLog(limit?: number): Promise<BrainCommit[]>;

  /** Restore a previous state by commit hash. */
  rollback(hash: string): Promise<BrainCommit | null>;
}

export interface FrontalLobe {
  /** Get current working memory content. */
  get(): Promise<string>;

  /** Update working memory and auto-commit. */
  update(content: string): Promise<BrainCommit>;
}

export interface EmotionTracker {
  /** Get current emotion state. */
  getEmotion(): Promise<EmotionState>;

  /** Update emotion state with a reason, auto-commits. */
  updateEmotion(state: Omit<EmotionState, 'updatedAt'>, reason?: string): Promise<BrainCommit>;
}

export interface PersonaManager {
  /** Get active persona (override if exists, else default). */
  getPersona(): Promise<string>;

  /** Update persona override. */
  setPersona(content: string): Promise<void>;

  /** Reset to default persona. */
  resetPersona(): Promise<void>;
}
