import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { StrategyStore } from '../../src/strategies/strategy-store.js';

describe('StrategyStore migration', () => {
  it('migrates old triggers format to triggerGroups on initialize', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strategy-migrate-'));
    try {
      const oldFormat = {
        id: 'test-old',
        name: 'Old Format Strategy',
        description: 'Test migration',
        category: 'MARKET',
        active: true,
        source: 'custom',
        style: 'momentum',
        requires: ['technicals'],
        createdBy: 'test',
        createdAt: '2026-01-01T00:00:00.000Z',
        content: '# Test\nBuy when conditions met.',
        triggers: [
          {
            type: 'INDICATOR_THRESHOLD',
            description: 'RSI below 30',
            params: { indicator: 'RSI', threshold: 30, direction: 'below' },
          },
          { type: 'DRAWDOWN', description: 'Drawdown > 10%', params: { threshold: -0.1 } },
        ],
        tickers: [],
      };
      await writeFile(join(dir, 'test-old.json'), JSON.stringify(oldFormat));

      const store = new StrategyStore({ dir });
      await store.initialize();

      const strategy = store.getById('test-old');
      expect(strategy).toBeDefined();
      expect(strategy!.triggerGroups).toHaveLength(2);
      expect(strategy!.triggerGroups[0].conditions).toHaveLength(1);
      expect(strategy!.triggerGroups[0].conditions[0].type).toBe('INDICATOR_THRESHOLD');
      expect(strategy!.triggerGroups[1].conditions).toHaveLength(1);
      expect(strategy!.triggerGroups[1].conditions[0].type).toBe('DRAWDOWN');

      const saved = JSON.parse(await readFile(join(dir, 'test-old.json'), 'utf-8'));
      expect(saved.triggerGroups).toBeDefined();
      expect(saved.triggers).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it('loads new triggerGroups format without migration', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strategy-migrate-'));
    try {
      const newFormat = {
        id: 'test-new',
        name: 'New Format Strategy',
        description: 'Already migrated',
        category: 'MARKET',
        active: true,
        source: 'custom',
        style: 'momentum',
        requires: [],
        createdBy: 'test',
        createdAt: '2026-01-01T00:00:00.000Z',
        content: '# Test',
        triggerGroups: [
          {
            label: 'Entry',
            conditions: [
              {
                type: 'INDICATOR_THRESHOLD',
                description: 'RSI below 30',
                params: { indicator: 'RSI', threshold: 30, direction: 'below' },
              },
              { type: 'PRICE_MOVE', description: 'Drop > 5%', params: { threshold: -0.05 } },
            ],
          },
        ],
        tickers: [],
      };
      await writeFile(join(dir, 'test-new.json'), JSON.stringify(newFormat));

      const store = new StrategyStore({ dir });
      await store.initialize();

      const strategy = store.getById('test-new');
      expect(strategy).toBeDefined();
      expect(strategy!.triggerGroups).toHaveLength(1);
      expect(strategy!.triggerGroups[0].conditions).toHaveLength(2);
      expect(strategy!.triggerGroups[0].label).toBe('Entry');
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
