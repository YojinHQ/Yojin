import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BrainStore } from '../../src/brain/brain.js';
import { EmotionTracker } from '../../src/brain/emotion.js';
import { FrontalLobe } from '../../src/brain/frontal-lobe.js';
import type { ToolDefinition } from '../../src/core/types.js';
import { createPortfolioReasoningTools } from '../../src/tools/portfolio-reasoning.js';

let tmpDir: string;
let tool: ToolDefinition;
let frontalLobe: FrontalLobe;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'reasoning-test-'));
  const brain = new BrainStore(tmpDir);
  frontalLobe = new FrontalLobe(brain, tmpDir);
  const emotionTracker = new EmotionTracker(brain, tmpDir);

  const tools = createPortfolioReasoningTools({ frontalLobe, emotionTracker });
  tool = tools[0];
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('createPortfolioReasoningTools', () => {
  it('creates 1 tool', () => {
    const brain = new BrainStore(tmpDir);
    const tools = createPortfolioReasoningTools({
      frontalLobe: new FrontalLobe(brain, tmpDir),
      emotionTracker: new EmotionTracker(brain, tmpDir),
    });
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('portfolio_reasoning');
  });
});

describe('portfolio_reasoning', () => {
  it('builds reasoning chain from question and data points', async () => {
    const result = await tool.execute({
      question: 'Should I reduce NVDA position?',
      dataPoints: ['NVDA RSI: 78', 'NVDA is 34% of portfolio', 'VIX: 22'],
    });

    expect(result.content).toContain('Should I reduce NVDA position?');
    expect(result.content).toContain('NVDA RSI: 78');
    expect(result.content).toContain('NVDA is 34% of portfolio');
    expect(result.content).toContain('VIX: 22');
    expect(result.content).toContain('Reasoning persisted to working memory');
    expect(result.content).toContain('Commit:');
  });

  it('includes emotional context in reasoning', async () => {
    const result = await tool.execute({
      question: 'Market outlook?',
      dataPoints: ['S&P 500 near ATH'],
    });

    expect(result.content).toContain('Emotional Context');
    expect(result.content).toContain('Confidence: 0.5');
    expect(result.content).toContain('Risk Appetite: 0.5');
  });

  it('includes hypotheses when provided', async () => {
    const result = await tool.execute({
      question: 'Is tech sector rotation happening?',
      dataPoints: ['QQQ down 3% this week', 'XLF up 2%'],
      currentHypotheses: ['Rotation from growth to value', 'Rate expectations driving change'],
    });

    expect(result.content).toContain('Hypotheses Under Review');
    expect(result.content).toContain('Rotation from growth to value');
    expect(result.content).toContain('Rate expectations driving change');
  });

  it('persists reasoning to frontal lobe', async () => {
    await tool.execute({
      question: 'Portfolio rebalancing needed?',
      dataPoints: ['AAPL: 15%', 'MSFT: 12%'],
    });

    const memory = await frontalLobe.get();
    expect(memory).toContain('Portfolio rebalancing needed?');
    expect(memory).toContain('AAPL: 15%');
  });

  it('appends to existing working memory', async () => {
    await tool.execute({
      question: 'First analysis',
      dataPoints: ['Data A'],
    });

    await tool.execute({
      question: 'Second analysis',
      dataPoints: ['Data B'],
    });

    const memory = await frontalLobe.get();
    expect(memory).toContain('First analysis');
    expect(memory).toContain('Second analysis');
    expect(memory).toContain('---');
  });
});
