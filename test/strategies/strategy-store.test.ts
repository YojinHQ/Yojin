import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StrategyStore } from '../../src/strategies/strategy-store.js';
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

describe('StrategyStore', () => {
  let dir: string;
  let store: StrategyStore;

  beforeEach(() => {
    dir = join(tmpdir(), `yojin-strategy-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    store = new StrategyStore({ dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('create', () => {
    it('creates a new strategy', () => {
      const strategy = makeStrategy();
      store.create(strategy);
      expect(store.getById('test-strategy')).toBeDefined();
      expect(store.getById('test-strategy')!.name).toBe('Test Strategy');
    });

    it('throws if strategy id already exists', () => {
      const strategy = makeStrategy();
      store.create(strategy);
      expect(() => store.create(strategy)).toThrow(/already exists/);
    });

    it('persists to disk', () => {
      store.create(makeStrategy());
      expect(existsSync(join(dir, 'test-strategy.json'))).toBe(true);
    });
  });

  describe('update', () => {
    it('updates an existing strategy', () => {
      store.create(makeStrategy());
      store.update('test-strategy', { name: 'Updated Name', description: 'Updated desc' });
      expect(store.getById('test-strategy')!.name).toBe('Updated Name');
    });

    it('throws if strategy does not exist', () => {
      expect(() => store.update('nonexistent', { name: 'Nope' })).toThrow(/not found/);
    });

    it('preserves fields not in the update', () => {
      store.create(makeStrategy());
      store.update('test-strategy', { name: 'New Name' });
      const updated = store.getById('test-strategy')!;
      expect(updated.category).toBe('MARKET');
      expect(updated.content).toBe('## Thesis\nTest content');
    });
  });

  describe('initialize + round-trip', () => {
    it('loads created strategies from disk', async () => {
      store.create(makeStrategy());
      const store2 = new StrategyStore({ dir });
      await store2.initialize();
      expect(store2.getById('test-strategy')).toBeDefined();
    });
  });
});
