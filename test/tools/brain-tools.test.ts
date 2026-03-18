import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BrainStore } from '../../src/brain/brain.js';
import { EmotionTracker } from '../../src/brain/emotion.js';
import { FrontalLobe } from '../../src/brain/frontal-lobe.js';
import { PersonaManager } from '../../src/brain/persona.js';
import type { ToolDefinition } from '../../src/core/types.js';
import { createBrainTools } from '../../src/tools/brain-tools.js';

let tmpDir: string;
let tools: ToolDefinition[];
let brain: BrainStore;

function getTool(name: string): ToolDefinition {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'brain-tools-test-'));
  brain = new BrainStore(tmpDir);
  const frontalLobe = new FrontalLobe(brain, tmpDir);
  const emotionTracker = new EmotionTracker(brain, tmpDir);
  const persona = new PersonaManager(tmpDir);

  tools = createBrainTools({ brain, frontalLobe, emotionTracker, persona });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('createBrainTools', () => {
  it('creates 7 tools', () => {
    expect(tools).toHaveLength(7);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'brain_get_emotion',
      'brain_get_log',
      'brain_get_memory',
      'brain_get_persona',
      'brain_rollback',
      'brain_update_emotion',
      'brain_update_memory',
    ]);
  });
});

describe('brain_get_memory', () => {
  it('returns default working memory', async () => {
    const result = await getTool('brain_get_memory').execute({});
    expect(result.content).toContain('No active reasoning chains');
  });
});

describe('brain_update_memory', () => {
  it('updates working memory and returns commit info', async () => {
    const result = await getTool('brain_update_memory').execute({
      content: '# Hypothesis: NVDA is overvalued based on RSI 78',
    });
    expect(result.content).toContain('Working memory updated');
    expect(result.content).toContain('Commit:');

    // Verify it persisted
    const getResult = await getTool('brain_get_memory').execute({});
    expect(getResult.content).toContain('NVDA is overvalued');
  });
});

describe('brain_get_emotion', () => {
  it('returns default emotion state', async () => {
    const result = await getTool('brain_get_emotion').execute({});
    expect(result.content).toContain('Confidence: 0.5');
    expect(result.content).toContain('Risk Appetite: 0.5');
    expect(result.content).toContain('moderate');
  });
});

describe('brain_update_emotion', () => {
  it('updates emotion and returns commit info', async () => {
    const result = await getTool('brain_update_emotion').execute({
      confidence: 0.8,
      riskAppetite: 0.2,
      reason: 'Strong earnings beat across holdings',
    });
    expect(result.content).toContain('confidence: 0.8');
    expect(result.content).toContain('risk appetite: 0.2');
    expect(result.content).toContain('Commit:');

    // Verify it persisted
    const getResult = await getTool('brain_get_emotion').execute({});
    expect(getResult.content).toContain('Confidence: 0.8');
    expect(getResult.content).toContain('very low');
    expect(getResult.content).toContain('Strong earnings beat');
  });
});

describe('brain_get_persona', () => {
  it('returns fallback when no persona configured', async () => {
    const result = await getTool('brain_get_persona').execute({});
    expect(result.content).toContain('No persona configured');
  });
});

describe('brain_get_log', () => {
  it('returns empty log initially', async () => {
    const result = await getTool('brain_get_log').execute({ limit: 10 });
    expect(result.content).toBe('No brain commits yet.');
  });

  it('returns commits after brain updates', async () => {
    await getTool('brain_update_memory').execute({ content: 'test memory' });
    await getTool('brain_update_emotion').execute({
      confidence: 0.9,
      riskAppetite: 0.4,
      reason: 'test',
    });

    const result = await getTool('brain_get_log').execute({ limit: 10 });
    expect(result.content).toContain('frontal-lobe');
    expect(result.content).toContain('emotion');
  });
});

describe('brain_rollback', () => {
  it('rolls back to a previous commit', async () => {
    await getTool('brain_update_memory').execute({ content: 'version 1' });

    const log1 = await brain.getLog(1);
    const hash = log1[0].hash;

    await getTool('brain_update_memory').execute({ content: 'version 2' });

    const result = await getTool('brain_rollback').execute({ hash });
    expect(result.content).toContain('Rolled back to commit');
    expect(result.content).toContain(hash.slice(0, 8));
  });

  it('returns error for unknown hash', async () => {
    const result = await getTool('brain_rollback').execute({ hash: 'nonexistent0' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Commit not found');
  });
});
