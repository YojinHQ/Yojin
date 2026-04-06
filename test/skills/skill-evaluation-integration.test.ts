import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Entity } from '@yojinhq/jintel-client';
import { describe, expect, it } from 'vitest';

import { buildPortfolioContext } from '../../src/skills/portfolio-context-builder.js';
import { SkillEvaluator } from '../../src/skills/skill-evaluator.js';
import { SkillStore } from '../../src/skills/skill-store.js';
import type { Skill } from '../../src/skills/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSkill(overrides: Partial<Skill> & Pick<Skill, 'id' | 'triggers'>): Skill {
  return {
    name: 'Test Strategy',
    description: 'Test',
    category: 'MARKET',
    active: true,
    source: 'custom',
    style: 'mean_reversion',
    requires: ['technicals'],
    createdBy: 'test',
    createdAt: new Date().toISOString(),
    content: '# Test\nBuy when conditions met.',
    tickers: [],
    ...overrides,
  };
}

function makeSnapshot(positions: { symbol: string; currentPrice: number; marketValue: number }[], totalValue: number) {
  return { positions, totalValue };
}

function makeEntity(
  ticker: string,
  opts?: {
    rsi?: number | null;
    fiftyTwoWeekHigh?: number | null;
  },
): Entity {
  return {
    id: ticker,
    name: ticker,
    type: 'COMPANY' as const,
    tickers: [ticker],
    technicals:
      opts?.rsi != null
        ? {
            ticker,
            rsi: opts.rsi,
            macd: null,
            bollingerBands: null,
            ema: null,
            sma: null,
            atr: null,
            vwma: null,
            mfi: null,
          }
        : null,
    market: {
      quote: null,
      fundamentals:
        opts?.fiftyTwoWeekHigh != null
          ? { fiftyTwoWeekHigh: opts.fiftyTwoWeekHigh, fiftyTwoWeekLow: 0, source: 'yf' }
          : null,
    },
  } as Entity;
}

// ---------------------------------------------------------------------------
// Integration tests: buildPortfolioContext -> SkillEvaluator.evaluate
// ---------------------------------------------------------------------------

describe('skill evaluation integration', () => {
  it('INDICATOR_THRESHOLD fires when RSI is below threshold', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skill-eval-'));
    try {
      const skill = makeSkill({
        id: 'test-rsi-oversold',
        triggers: [
          {
            type: 'INDICATOR_THRESHOLD',
            description: 'RSI below 30',
            params: { indicator: 'RSI', threshold: 30, direction: 'below' },
          },
        ],
      });
      await writeFile(join(dir, `${skill.id}.json`), JSON.stringify(skill));

      const store = new SkillStore({ dir });
      await store.initialize();

      const snapshot = makeSnapshot(
        [
          { symbol: 'AAPL', currentPrice: 150, marketValue: 5000 },
          { symbol: 'GOOG', currentPrice: 100, marketValue: 5000 },
        ],
        10000,
      );

      const entities = [makeEntity('AAPL', { rsi: 25.0 }), makeEntity('GOOG', { rsi: 55.0 })];

      const ctx = buildPortfolioContext(snapshot, [], entities);
      const evaluator = new SkillEvaluator(store);
      const results = evaluator.evaluate(ctx);

      expect(results).toHaveLength(1);
      expect(results[0].context['ticker']).toBe('AAPL');
      expect(results[0].context['indicator']).toBe('RSI');
      expect(results[0].context['value']).toBe(25.0);
      expect(results[0].context['threshold']).toBe(30);
      expect(results[0].triggerType).toBe('INDICATOR_THRESHOLD');
      expect(results[0].skillId).toBe('test-rsi-oversold');
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it('DRAWDOWN fires when position drops past threshold', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skill-eval-'));
    try {
      const skill = makeSkill({
        id: 'test-drawdown',
        category: 'RISK',
        triggers: [
          {
            type: 'DRAWDOWN',
            description: 'Position drawdown exceeds 15%',
            params: { threshold: -0.15 },
          },
        ],
      });
      await writeFile(join(dir, `${skill.id}.json`), JSON.stringify(skill));

      const store = new SkillStore({ dir });
      await store.initialize();

      // TSLA: price 80, 52wk high 100 -> drawdown = (80-100)/100 = -0.20 (fires)
      // MSFT: price 400, 52wk high 420 -> drawdown = (400-420)/420 = -0.0476 (doesn't fire)
      const snapshot = makeSnapshot(
        [
          { symbol: 'TSLA', currentPrice: 80, marketValue: 4000 },
          { symbol: 'MSFT', currentPrice: 400, marketValue: 6000 },
        ],
        10000,
      );

      const entities = [makeEntity('TSLA', { fiftyTwoWeekHigh: 100 }), makeEntity('MSFT', { fiftyTwoWeekHigh: 420 })];

      const ctx = buildPortfolioContext(snapshot, [], entities);

      // Verify drawdowns are computed correctly before evaluating
      expect(ctx.positionDrawdowns['TSLA']).toBeCloseTo(-0.2);
      expect(ctx.positionDrawdowns['MSFT']).toBeCloseTo(-0.0476, 3);

      const evaluator = new SkillEvaluator(store);
      const results = evaluator.evaluate(ctx);

      expect(results).toHaveLength(1);
      expect(results[0].context['ticker']).toBe('TSLA');
      expect(results[0].context['drawdown']).toBeCloseTo(-0.2);
      expect(results[0].context['threshold']).toBe(-0.15);
      expect(results[0].triggerType).toBe('DRAWDOWN');
      expect(results[0].skillId).toBe('test-drawdown');
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it('CONCENTRATION_DRIFT fires for overweight positions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skill-eval-'));
    try {
      const skill = makeSkill({
        id: 'test-concentration',
        category: 'PORTFOLIO',
        triggers: [
          {
            type: 'CONCENTRATION_DRIFT',
            description: 'Position exceeds 12% weight',
            params: { maxWeight: 0.12 },
          },
        ],
      });
      await writeFile(join(dir, `${skill.id}.json`), JSON.stringify(skill));

      const store = new SkillStore({ dir });
      await store.initialize();

      // AAPL: 60% weight, GOOG: 40% weight — both exceed 12%
      const snapshot = makeSnapshot(
        [
          { symbol: 'AAPL', currentPrice: 150, marketValue: 6000 },
          { symbol: 'GOOG', currentPrice: 100, marketValue: 4000 },
        ],
        10000,
      );

      const ctx = buildPortfolioContext(snapshot, [], []);

      // Verify weights before evaluating
      expect(ctx.weights['AAPL']).toBeCloseTo(0.6);
      expect(ctx.weights['GOOG']).toBeCloseTo(0.4);

      const evaluator = new SkillEvaluator(store);
      const results = evaluator.evaluate(ctx);

      expect(results).toHaveLength(2);

      const tickers = results.map((r) => r.context['ticker']).sort();
      expect(tickers).toEqual(['AAPL', 'GOOG']);

      const aaplResult = results.find((r) => r.context['ticker'] === 'AAPL')!;
      expect(aaplResult.context['weight']).toBeCloseTo(0.6);
      expect(aaplResult.context['maxWeight']).toBe(0.12);
      expect(aaplResult.triggerType).toBe('CONCENTRATION_DRIFT');

      const googResult = results.find((r) => r.context['ticker'] === 'GOOG')!;
      expect(googResult.context['weight']).toBeCloseTo(0.4);
      expect(googResult.context['maxWeight']).toBe(0.12);
      expect(googResult.skillId).toBe('test-concentration');
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
