/**
 * Brain tools — expose the Strategist's cognitive state as agent tools.
 *
 * These tools let the Strategist interact with its persistent brain
 * (working memory, emotion, persona, commit history) through the TAO loop.
 */

import { z } from 'zod';

import type { Brain, EmotionTracker, FrontalLobe, PersonaManager } from '../brain/types.js';
import type { ToolDefinition, ToolResult } from '../core/types.js';

export interface BrainToolsOptions {
  brain: Brain;
  frontalLobe: FrontalLobe;
  emotionTracker: EmotionTracker;
  persona: PersonaManager;
}

export function createBrainTools(options: BrainToolsOptions): ToolDefinition[] {
  const { brain, frontalLobe, emotionTracker, persona } = options;

  const getMemory: ToolDefinition = {
    name: 'brain_get_memory',
    description:
      'Read the current working memory (frontal lobe). Contains active hypotheses, ' +
      'observations, and reasoning chains from previous analysis.',
    parameters: z.object({}),
    async execute(): Promise<ToolResult> {
      const content = await frontalLobe.get();
      return { content };
    },
  };

  const updateMemory: ToolDefinition = {
    name: 'brain_update_memory',
    description:
      'Update working memory with new observations or reasoning. ' +
      'Automatically creates a versioned commit so you can review or rollback later.',
    parameters: z.object({
      content: z.string().min(1).describe('New working memory content (Markdown)'),
    }),
    async execute(params: { content: string }): Promise<ToolResult> {
      const commit = await frontalLobe.update(params.content);
      return {
        content: `Working memory updated. Commit: ${commit.hash} — "${commit.message}"`,
      };
    },
  };

  const getEmotion: ToolDefinition = {
    name: 'brain_get_emotion',
    description:
      'Get current confidence level (0-1) and risk appetite (0-1) with rationale. ' +
      'These influence your tone and recommendation style.',
    parameters: z.object({}),
    async execute(): Promise<ToolResult> {
      const state = await emotionTracker.getEmotion();
      return {
        content: [
          `Confidence: ${state.confidence} (${describeLevel(state.confidence)})`,
          `Risk Appetite: ${state.riskAppetite} (${describeLevel(state.riskAppetite)})`,
          `Reason: ${state.reason}`,
          `Updated: ${state.updatedAt}`,
        ].join('\n'),
      };
    },
  };

  const updateEmotion: ToolDefinition = {
    name: 'brain_update_emotion',
    description:
      'Update confidence and risk appetite levels based on new data or analysis. ' +
      'Always provide a reason explaining why the levels changed.',
    parameters: z.object({
      confidence: z.number().min(0).max(1).describe('Confidence level 0-1 (0 = very uncertain, 1 = very confident)'),
      riskAppetite: z.number().min(0).max(1).describe('Risk appetite 0-1 (0 = very conservative, 1 = aggressive)'),
      reason: z.string().min(1).describe('Why these levels changed'),
    }),
    async execute(params: { confidence: number; riskAppetite: number; reason: string }): Promise<ToolResult> {
      const commit = await emotionTracker.updateEmotion(params);
      return {
        content:
          `Emotion updated — confidence: ${params.confidence}, ` +
          `risk appetite: ${params.riskAppetite}. ` +
          `Commit: ${commit.hash}`,
      };
    },
  };

  const getPersona: ToolDefinition = {
    name: 'brain_get_persona',
    description: 'Get the active persona — your personality, communication style, and constraint rules.',
    parameters: z.object({}),
    async execute(): Promise<ToolResult> {
      const content = await persona.getPersona();
      return { content };
    },
  };

  const setPersona: ToolDefinition = {
    name: 'brain_set_persona',
    description:
      'Update the active persona — rewrite your personality, communication style, and constraint rules. ' +
      'The content should be a complete Markdown persona document.',
    parameters: z.object({
      content: z.string().min(1).describe('Full persona document in Markdown'),
    }),
    async execute(params: { content: string }): Promise<ToolResult> {
      await persona.setPersona(params.content);
      return { content: 'Persona updated successfully.' };
    },
  };

  const getLog: ToolDefinition = {
    name: 'brain_get_log',
    description:
      'Get the brain commit history — versioned snapshots of working memory, ' +
      'emotion changes, and persona updates.',
    parameters: z.object({
      limit: z.number().int().min(1).max(100).default(10).describe('Max commits to return (default 10)'),
    }),
    async execute(params: { limit: number }): Promise<ToolResult> {
      const log = await brain.getLog(params.limit);
      if (log.length === 0) {
        return { content: 'No brain commits yet.' };
      }
      const lines = log.map((c) => `[${c.hash.slice(0, 8)}] ${c.type} — ${c.message} (${c.timestamp})`);
      return { content: lines.join('\n') };
    },
  };

  const rollback: ToolDefinition = {
    name: 'brain_rollback',
    description:
      'Restore a previous brain state by commit hash. ' + 'Use brain_get_log to find the hash you want to restore.',
    parameters: z.object({
      hash: z.string().min(1).describe('Commit hash to restore'),
    }),
    async execute(params: { hash: string }): Promise<ToolResult> {
      const commit = await brain.rollback(params.hash);
      if (!commit) {
        return { content: `Commit not found: ${params.hash}`, isError: true };
      }
      return {
        content: `Rolled back to commit ${commit.hash.slice(0, 8)} — "${commit.message}" (${commit.timestamp})`,
      };
    },
  };

  return [getMemory, updateMemory, getEmotion, updateEmotion, getPersona, setPersona, getLog, rollback];
}

function describeLevel(value: number): string {
  if (value <= 0.2) return 'very low';
  if (value <= 0.4) return 'low';
  if (value <= 0.6) return 'moderate';
  if (value <= 0.8) return 'high';
  return 'very high';
}
