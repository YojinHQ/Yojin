import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BrainStore } from '../src/brain/brain.js';
import { EmotionTracker } from '../src/brain/emotion.js';
import { FrontalLobe } from '../src/brain/frontal-lobe.js';
import { loadAgentPrompt, PersonaManager } from '../src/brain/persona.js';
import { DEFAULT_EMOTION_VALUES } from '../src/brain/types.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'brain-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// BrainStore — commit / log / rollback
// ---------------------------------------------------------------------------

describe('BrainStore', () => {
  it('creates a commit and retrieves it from the log', async () => {
    const brain = new BrainStore(tmpDir);
    const commit = await brain.commit('test snapshot', 'manual', { foo: 'bar' });

    expect(commit.hash).toHaveLength(12);
    expect(commit.message).toBe('test snapshot');
    expect(commit.type).toBe('manual');
    expect(commit.snapshot).toEqual({ foo: 'bar' });

    const log = await brain.getLog();
    expect(log).toHaveLength(1);
    expect(log[0].hash).toBe(commit.hash);
  });

  it('returns newest commits first', async () => {
    const brain = new BrainStore(tmpDir);
    await brain.commit('first', 'manual', { n: 1 });
    await brain.commit('second', 'manual', { n: 2 });
    await brain.commit('third', 'manual', { n: 3 });

    const log = await brain.getLog();
    expect(log.map((c) => c.message)).toEqual(['third', 'second', 'first']);
  });

  it('respects the limit parameter', async () => {
    const brain = new BrainStore(tmpDir);
    await brain.commit('a', 'manual', {});
    await brain.commit('b', 'manual', {});
    await brain.commit('c', 'manual', {});

    const log = await brain.getLog(2);
    expect(log).toHaveLength(2);
    expect(log[0].message).toBe('c');
  });

  it('returns empty log when no commits exist', async () => {
    const brain = new BrainStore(tmpDir);
    const log = await brain.getLog();
    expect(log).toEqual([]);
  });

  it('rollback creates a new commit restoring the target snapshot', async () => {
    const brain = new BrainStore(tmpDir);
    const c1 = await brain.commit('original', 'manual', { state: 'v1' });
    await brain.commit('changed', 'manual', { state: 'v2' });

    const rollbackCommit = await brain.rollback(c1.hash);
    expect(rollbackCommit).not.toBeNull();
    expect(rollbackCommit!.message).toContain(`rollback to ${c1.hash}`);
    expect(rollbackCommit!.snapshot).toEqual({ state: 'v1' });

    const log = await brain.getLog();
    expect(log).toHaveLength(3);
    expect(log[0].snapshot).toEqual({ state: 'v1' });
  });

  it('rollback returns null for unknown hash', async () => {
    const brain = new BrainStore(tmpDir);
    const result = await brain.rollback('nonexistent0');
    expect(result).toBeNull();
  });

  it('produces unique hashes for different commits', async () => {
    const brain = new BrainStore(tmpDir);
    const c1 = await brain.commit('a', 'manual', { x: 1 });
    const c2 = await brain.commit('b', 'manual', { x: 2 });
    expect(c1.hash).not.toBe(c2.hash);
  });

  it('persists commits to JSONL file', async () => {
    const brain = new BrainStore(tmpDir);
    await brain.commit('persist test', 'manual', { v: 1 });

    const raw = await readFile(join(tmpDir, 'data/brain/commits.jsonl'), 'utf-8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.message).toBe('persist test');
  });
});

// ---------------------------------------------------------------------------
// FrontalLobe — working memory
// ---------------------------------------------------------------------------

describe('FrontalLobe', () => {
  it('returns default content when no file exists', async () => {
    const brain = new BrainStore(tmpDir);
    const lobe = new FrontalLobe(brain, tmpDir);

    const content = await lobe.get();
    expect(content).toContain('Working Memory');
    expect(content).toContain('No active reasoning chains');
  });

  it('update writes content and auto-commits', async () => {
    const brain = new BrainStore(tmpDir);
    const lobe = new FrontalLobe(brain, tmpDir);

    const commit = await lobe.update('# Working Memory\n\nNVDA RSI approaching 80.');
    expect(commit.type).toBe('frontal-lobe');
    expect(commit.message).toBe('initial working memory');

    const content = await lobe.get();
    expect(content).toContain('NVDA RSI approaching 80');
  });

  it('subsequent updates record updated message', async () => {
    const brain = new BrainStore(tmpDir);
    const lobe = new FrontalLobe(brain, tmpDir);

    await lobe.update('first version');
    const c2 = await lobe.update('second version — longer content here');

    expect(c2.message).toContain('updated working memory');
    expect(c2.message).toContain('chars');
  });
});

// ---------------------------------------------------------------------------
// EmotionTracker — confidence and risk appetite
// ---------------------------------------------------------------------------

describe('EmotionTracker', () => {
  it('returns default emotion when no file exists', async () => {
    const brain = new BrainStore(tmpDir);
    const tracker = new EmotionTracker(brain, tmpDir);

    const emotion = await tracker.getEmotion();
    expect(emotion.confidence).toBe(DEFAULT_EMOTION_VALUES.confidence);
    expect(emotion.riskAppetite).toBe(DEFAULT_EMOTION_VALUES.riskAppetite);
    expect(emotion.reason).toBe(DEFAULT_EMOTION_VALUES.reason);
  });

  it('updates emotion state and auto-commits', async () => {
    const brain = new BrainStore(tmpDir);
    const tracker = new EmotionTracker(brain, tmpDir);

    const commit = await tracker.updateEmotion({
      confidence: 0.8,
      riskAppetite: 0.3,
      reason: 'VIX spike to 35',
    });

    expect(commit.type).toBe('emotion');
    expect(commit.message).toContain('confidence');
    expect(commit.message).toContain('risk appetite');

    const state = await tracker.getEmotion();
    expect(state.confidence).toBe(0.8);
    expect(state.riskAppetite).toBe(0.3);
    expect(state.reason).toBe('VIX spike to 35');
    expect(state.updatedAt).toBeDefined();
  });

  it('tracks delta between states in commit message', async () => {
    const brain = new BrainStore(tmpDir);
    const tracker = new EmotionTracker(brain, tmpDir);

    await tracker.updateEmotion({ confidence: 0.7, riskAppetite: 0.5, reason: 'initial' });
    const c2 = await tracker.updateEmotion({
      confidence: 0.3,
      riskAppetite: 0.5,
      reason: 'market drop',
    });

    // Only confidence changed, riskAppetite stayed the same
    expect(c2.message).toContain('confidence');
    expect(c2.message).not.toContain('risk appetite');
  });

  it('falls back to defaults on invalid JSON', async () => {
    const brain = new BrainStore(tmpDir);
    const tracker = new EmotionTracker(brain, tmpDir);

    const emotionDir = join(tmpDir, 'data/brain');
    await mkdir(emotionDir, { recursive: true });
    await writeFile(join(emotionDir, 'emotion.json'), '{ invalid json }', 'utf-8');

    // Should not throw — falls back to defaults
    const emotion = await tracker.getEmotion();
    expect(emotion.confidence).toBe(DEFAULT_EMOTION_VALUES.confidence);
  });

  it('overrides reason when explicit reason parameter is passed', async () => {
    const brain = new BrainStore(tmpDir);
    const tracker = new EmotionTracker(brain, tmpDir);

    await tracker.updateEmotion(
      { confidence: 0.9, riskAppetite: 0.8, reason: 'state reason' },
      'override reason from caller',
    );

    const state = await tracker.getEmotion();
    expect(state.reason).toBe('override reason from caller');
  });
});

// ---------------------------------------------------------------------------
// PersonaManager — default / override pattern
// ---------------------------------------------------------------------------

describe('PersonaManager', () => {
  it('returns fallback message when no persona files exist', async () => {
    const mgr = new PersonaManager(tmpDir);
    const persona = await mgr.getPersona();
    expect(persona).toContain('No persona configured');
  });

  it('auto-copies default to override on first read', async () => {
    const mgr = new PersonaManager(tmpDir);

    // Create the default file
    const defaultDir = join(tmpDir, 'data/default');
    await mkdir(defaultDir, { recursive: true });
    await writeFile(join(defaultDir, 'persona.default.md'), '# Conservative Analyst\n');

    const persona = await mgr.getPersona();
    expect(persona).toBe('# Conservative Analyst\n');

    // Override should now exist
    const overrideContent = await readFile(join(tmpDir, 'data/brain/persona.md'), 'utf-8');
    expect(overrideContent).toBe('# Conservative Analyst\n');
  });

  it('setPersona creates an override', async () => {
    const mgr = new PersonaManager(tmpDir);
    await mgr.setPersona('# Aggressive Trader\n');

    const persona = await mgr.getPersona();
    expect(persona).toBe('# Aggressive Trader\n');
  });

  it('override takes priority over default', async () => {
    const mgr = new PersonaManager(tmpDir);

    const defaultDir = join(tmpDir, 'data/default');
    await mkdir(defaultDir, { recursive: true });
    await writeFile(join(defaultDir, 'persona.default.md'), '# Default\n');

    await mgr.setPersona('# Custom Override\n');

    const persona = await mgr.getPersona();
    expect(persona).toBe('# Custom Override\n');
  });

  it('resetPersona removes override, falls back to default', async () => {
    const mgr = new PersonaManager(tmpDir);

    const defaultDir = join(tmpDir, 'data/default');
    await mkdir(defaultDir, { recursive: true });
    await writeFile(join(defaultDir, 'persona.default.md'), '# Default\n');

    await mgr.setPersona('# Override\n');
    await mgr.resetPersona();

    // Should auto-copy default again
    const persona = await mgr.getPersona();
    expect(persona).toBe('# Default\n');
  });
});

// ---------------------------------------------------------------------------
// loadAgentPrompt — agent system prompt loading
// ---------------------------------------------------------------------------

describe('loadAgentPrompt', () => {
  it('loads from default path', async () => {
    const agentDir = join(tmpDir, 'data/default/agents');
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, 'strategist.default.md'), '# Strategist\nYou decide.\n');

    const prompt = await loadAgentPrompt('strategist', tmpDir);
    expect(prompt).toBe('# Strategist\nYou decide.\n');
  });

  it('override takes priority over default', async () => {
    const defaultDir = join(tmpDir, 'data/default/agents');
    const overrideDir = join(tmpDir, 'data/brain/agents');
    await mkdir(defaultDir, { recursive: true });
    await mkdir(overrideDir, { recursive: true });

    await writeFile(join(defaultDir, 'strategist.default.md'), '# Default\n');
    await writeFile(join(overrideDir, 'strategist.md'), '# Custom Strategist\n');

    const prompt = await loadAgentPrompt('strategist', tmpDir);
    expect(prompt).toBe('# Custom Strategist\n');
  });

  it('returns generic fallback when no files exist', async () => {
    const prompt = await loadAgentPrompt('unknown-agent', tmpDir);
    expect(prompt).toContain('unknown-agent');
    expect(prompt).toContain('No specific system prompt configured');
  });
});
