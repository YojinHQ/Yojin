import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ToolDefinition } from '../../src/core/types.js';
import { StrategyEvaluator } from '../../src/strategies/strategy-evaluator.js';
import { StrategyStore } from '../../src/strategies/strategy-store.js';
import { createStrategyTools } from '../../src/strategies/strategy-tools.js';
import type { Strategy } from '../../src/strategies/types.js';

function makeStrategy(overrides: Partial<Strategy> = {}): Strategy {
  return {
    id: 'test-strategy',
    name: 'Test Strategy',
    description: 'A test strategy',
    category: 'MARKET',
    style: 'momentum',
    requires: ['market_data'],
    active: false,
    source: 'custom',
    createdBy: 'test',
    createdAt: '2026-01-01T00:00:00.000Z',
    content: '## Thesis\nTest content',
    triggerGroups: [{ label: '', conditions: [{ type: 'PRICE_MOVE', description: 'Test trigger' }] }],
    tickers: [],
    ...overrides,
  };
}

describe('createStrategyTools', () => {
  let dir: string;
  let strategyStore: StrategyStore;
  let strategyEvaluator: StrategyEvaluator;
  let tools: ToolDefinition[];

  function getTool(name: string): ToolDefinition {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    return tool;
  }

  beforeEach(() => {
    dir = join(tmpdir(), `yojin-strategy-tools-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    strategyStore = new StrategyStore({ dir });
    strategyEvaluator = new StrategyEvaluator(strategyStore);
    tools = createStrategyTools({ strategyStore, strategyEvaluator });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns 5 tools', () => {
    expect(tools).toHaveLength(5);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'activate_strategy',
      'deactivate_strategy',
      'get_strategy',
      'get_strategy_evaluations',
      'list_strategies',
    ]);
  });

  describe('list_strategies', () => {
    it('returns empty list when no strategies exist', async () => {
      const result = await getTool('list_strategies').execute({});
      expect(result.content).toContain('No strategies');
    });

    it('lists strategies with capability status', async () => {
      strategyStore.create(makeStrategy());
      strategyStore.create(makeStrategy({ id: 'strategy-2', name: 'Second Strategy', style: 'value', active: true }));

      const result = await getTool('list_strategies').execute({});
      expect(result.content).toContain('Test Strategy');
      expect(result.content).toContain('Second Strategy');
      expect(result.content).toContain('executable');
    });

    it('filters by query', async () => {
      strategyStore.create(makeStrategy({ id: 'alpha', name: 'Alpha Strategy' }));
      strategyStore.create(makeStrategy({ id: 'beta', name: 'Beta Hedge' }));

      const result = await getTool('list_strategies').execute({ query: 'Alpha' });
      expect(result.content).toContain('Alpha Strategy');
      expect(result.content).not.toContain('Beta Hedge');
    });

    it('filters by active status', async () => {
      strategyStore.create(makeStrategy({ id: 'active-one', name: 'Active One', active: true }));
      strategyStore.create(makeStrategy({ id: 'inactive-one', name: 'Inactive One', active: false }));

      const result = await getTool('list_strategies').execute({ active: true });
      expect(result.content).toContain('Active One');
      expect(result.content).not.toContain('Inactive One');
    });

    it('filters by category', async () => {
      strategyStore.create(makeStrategy({ id: 'risk-strategy', name: 'Risk Strategy', category: 'RISK' }));
      strategyStore.create(makeStrategy({ id: 'market-strategy', name: 'Market Strategy', category: 'MARKET' }));

      const result = await getTool('list_strategies').execute({ category: 'RISK' });
      expect(result.content).toContain('Risk Strategy');
      expect(result.content).not.toContain('Market Strategy');
    });

    it('filters by style', async () => {
      strategyStore.create(makeStrategy({ id: 'mom', name: 'Momentum Play', style: 'momentum' }));
      strategyStore.create(makeStrategy({ id: 'val', name: 'Value Play', style: 'value' }));

      const result = await getTool('list_strategies').execute({ style: 'value' });
      expect(result.content).toContain('Value Play');
      expect(result.content).not.toContain('Momentum Play');
    });
  });

  describe('get_strategy', () => {
    it('returns full strategy details with capability check', async () => {
      strategyStore.create(makeStrategy());

      const result = await getTool('get_strategy').execute({ id: 'test-strategy' });
      expect(result.content).toContain('Test Strategy');
      expect(result.content).toContain('PRICE_MOVE');
      expect(result.content).toContain('executable');
      expect(result.content).toContain('## Thesis');
    });

    it('returns error for nonexistent strategy', async () => {
      const result = await getTool('get_strategy').execute({ id: 'nonexistent' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('not found');
    });
  });

  describe('activate_strategy', () => {
    it('activates a strategy', async () => {
      strategyStore.create(makeStrategy());

      const result = await getTool('activate_strategy').execute({ id: 'test-strategy' });
      expect(result.content).toContain('activated');
      expect(strategyStore.getById('test-strategy')!.active).toBe(true);
    });

    it('activates strategy with all capabilities available', async () => {
      strategyStore.create(makeStrategy({ requires: ['derivatives'] }));

      const result = await getTool('activate_strategy').execute({ id: 'test-strategy' });
      expect(result.content).toContain('activated');
      expect(result.content).not.toMatch(/missing/i);
    });

    it('returns error for nonexistent strategy', async () => {
      const result = await getTool('activate_strategy').execute({ id: 'nonexistent' });
      expect(result.isError).toBe(true);
    });
  });

  describe('deactivate_strategy', () => {
    it('deactivates a strategy', async () => {
      strategyStore.create(makeStrategy({ active: true }));

      const result = await getTool('deactivate_strategy').execute({ id: 'test-strategy' });
      expect(result.content).toContain('deactivated');
      expect(strategyStore.getById('test-strategy')!.active).toBe(false);
    });

    it('returns error for nonexistent strategy', async () => {
      const result = await getTool('deactivate_strategy').execute({ id: 'nonexistent' });
      expect(result.isError).toBe(true);
    });
  });

  describe('get_strategy_evaluations', () => {
    it('returns evaluations for active strategies', async () => {
      strategyStore.create(
        makeStrategy({
          active: true,
          tickers: ['AAPL'],
          triggerGroups: [
            {
              label: '',
              conditions: [{ type: 'PRICE_MOVE', description: 'Drop >10%', params: { threshold: -0.1 } }],
            },
          ],
        }),
      );

      const result = await getTool('get_strategy_evaluations').execute({});
      // With empty portfolio context, no triggers fire
      expect(result.content).toContain('No strategy triggers fired');
    });

    it('returns message when no active strategies', async () => {
      strategyStore.create(makeStrategy({ active: false }));

      const result = await getTool('get_strategy_evaluations').execute({});
      expect(result.content).toContain('No active strategies');
    });
  });
});
