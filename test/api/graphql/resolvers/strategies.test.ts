import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resolveCreateStrategy,
  resolveDeleteStrategy,
  resolveExportStrategy,
  resolveImportStrategy,
  resolveStrategies,
  resolveUpdateStrategy,
  setStrategyStore,
} from '../../../../src/api/graphql/resolvers/strategies.js';
import type { StrategyStore } from '../../../../src/strategies/strategy-store.js';
import type { Strategy } from '../../../../src/strategies/types.js';

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
    assetClasses: [],
    ...overrides,
  };
}

function createMockStore(strategies: Strategy[] = []): StrategyStore {
  const map = new Map(strategies.map((s) => [s.id, s]));
  return {
    getAll: vi.fn(() => [...map.values()]),
    getById: vi.fn((id: string) => map.get(id)),
    create: vi.fn((strategy: Strategy) => {
      if (map.has(strategy.id)) throw new Error(`Strategy already exists: ${strategy.id}`);
      map.set(strategy.id, strategy);
    }),
    update: vi.fn((id: string, fields: Partial<Omit<Strategy, 'id'>>) => {
      const existing = map.get(id);
      if (!existing) throw new Error(`Strategy not found: ${id}`);
      const updated = { ...existing, ...fields, id };
      map.set(id, updated);
      return updated;
    }),
    delete: vi.fn((id: string) => {
      if (!map.has(id)) return false;
      map.delete(id);
      return true;
    }),
    setActive: vi.fn((id: string, active: boolean) => {
      const strategy = map.get(id);
      if (!strategy) return undefined;
      const updated = { ...strategy, active };
      map.set(id, updated);
      return updated;
    }),
    save: vi.fn(),
    initialize: vi.fn(),
  } as unknown as StrategyStore;
}

describe('strategies resolvers', () => {
  let store: StrategyStore;

  beforeEach(() => {
    store = createMockStore();
    setStrategyStore(store);
  });

  describe('resolveCreateStrategy', () => {
    it('creates a strategy and returns it', () => {
      const result = resolveCreateStrategy(null, {
        input: {
          name: 'Momentum Breakout',
          description: 'Buy on momentum breakout',
          category: 'MARKET',
          style: 'MOMENTUM',
          content: '## Thesis\nBuy breakouts',
          triggerGroups: [
            { label: '', conditions: [{ type: 'PRICE_MOVE', description: 'Price breaks above resistance' }] },
          ],
          tickers: ['AAPL'],
        },
      });
      expect(store.create).toHaveBeenCalled();
      expect(result).toMatchObject({
        name: 'Momentum Breakout',
        style: 'MOMENTUM',
        requires: ['MARKET_DATA'],
      });
    });
  });

  describe('resolveUpdateStrategy', () => {
    it('updates an existing strategy', () => {
      const strategy = makeStrategy();
      store = createMockStore([strategy]);
      setStrategyStore(store);

      const result = resolveUpdateStrategy(null, {
        id: 'test-strategy',
        input: { description: 'Updated description', style: 'VALUE' },
      });
      expect(store.update).toHaveBeenCalledWith(
        'test-strategy',
        expect.objectContaining({ description: 'Updated description', style: 'value' }),
      );
      expect(result).toMatchObject({ id: 'test-strategy', description: 'Updated description' });
    });

    it('throws for nonexistent strategy', () => {
      expect(() => resolveUpdateStrategy(null, { id: 'nope', input: { description: 'x' } })).toThrow(
        'Strategy not found',
      );
    });
  });

  describe('resolveDeleteStrategy', () => {
    it('deletes an existing strategy', () => {
      const strategy = makeStrategy();
      store = createMockStore([strategy]);
      setStrategyStore(store);

      const result = resolveDeleteStrategy(null, { id: 'test-strategy' });
      expect(store.delete).toHaveBeenCalledWith('test-strategy');
      expect(result).toBe(true);
    });

    it('throws for nonexistent strategy', () => {
      expect(() => resolveDeleteStrategy(null, { id: 'nope' })).toThrow('Strategy not found');
    });
  });

  describe('resolveImportStrategy', () => {
    it('imports from markdown string', () => {
      const md = `---
name: Imported Strategy
description: A strategy from markdown
category: MARKET
style: momentum
triggers:
  - type: PRICE_MOVE
    description: Price moves up
---

## Thesis
Buy the dip`;

      const result = resolveImportStrategy(null, { markdown: md });
      expect(store.create).toHaveBeenCalled();
      expect(result).toMatchObject({ name: 'Imported Strategy' });
    });

    it('throws when markdown is empty', () => {
      expect(() => resolveImportStrategy(null, { markdown: '' })).toThrow();
    });
  });

  describe('resolveExportStrategy', () => {
    it('exports a strategy as markdown', () => {
      const strategy = makeStrategy();
      store = createMockStore([strategy]);
      setStrategyStore(store);

      const result = resolveExportStrategy(null, { id: 'test-strategy' });
      expect(typeof result).toBe('string');
      expect(result).toContain('name: Test Strategy');
      expect(result).toContain('## Thesis');
    });
  });

  describe('resolveStrategies', () => {
    it('filters by style', () => {
      const strategies = [
        makeStrategy({ id: 'a', style: 'momentum' }),
        makeStrategy({ id: 'b', style: 'value' }),
        makeStrategy({ id: 'c', style: 'momentum' }),
      ];
      store = createMockStore(strategies);
      setStrategyStore(store);

      const result = resolveStrategies(null, { style: 'momentum' }) as Array<{ id: string }>;
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.id)).toEqual(['a', 'c']);
    });

    it('filters by query string', () => {
      const strategies = [
        makeStrategy({
          id: 'a',
          name: 'Momentum Breakout',
          description: 'Buy breakouts',
          content: '## Thesis\nBreakout',
        }),
        makeStrategy({ id: 'b', name: 'Value Play', description: 'Find value', content: '## Thesis\nValue' }),
      ];
      store = createMockStore(strategies);
      setStrategyStore(store);

      const result = resolveStrategies(null, { query: 'breakout' }) as Array<{ id: string }>;
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('a');
    });
  });
});
