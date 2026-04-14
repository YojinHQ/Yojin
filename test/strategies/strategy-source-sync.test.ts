import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/strategies/strategy-source-fetcher.js', () => ({
  fetchStrategiesFromSource: vi.fn(),
}));

import { fetchStrategiesFromSource } from '../../src/strategies/strategy-source-fetcher.js';
import type { FetchedStrategy } from '../../src/strategies/strategy-source-fetcher.js';
import { syncFromFetched, syncStrategies } from '../../src/strategies/strategy-source-sync.js';
import { DEFAULT_STRATEGY_SOURCE } from '../../src/strategies/strategy-source-types.js';
import { StrategyStore } from '../../src/strategies/strategy-store.js';

const TEST_DIR = join(tmpdir(), `strategy-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const STRATEGIES_DIR = join(TEST_DIR, 'strategies');

const validMarkdown = `---
name: Test Strategy
description: A test strategy
category: MARKET
style: momentum
requires: [market_data]
triggers:
  - type: PRICE_MOVE
    description: Test trigger
    params:
      threshold: 0.10
tickers: []
---

## Thesis
Test content here.
`;

const validMarkdown2 = `---
name: Another Strategy
description: Second test strategy
category: RISK
style: defensive
requires: [portfolio]
triggers:
  - type: DRAWDOWN
    description: Portfolio drawdown
    params:
      threshold: -0.10
tickers: []
---

## Thesis
Another test.
`;

function makeFetched(markdown: string, filename: string): FetchedStrategy {
  return { filename, markdown, source: DEFAULT_STRATEGY_SOURCE };
}

beforeEach(() => {
  mkdirSync(STRATEGIES_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('syncFromFetched', () => {
  it('saves new strategies and returns added count', async () => {
    const store = new StrategyStore({ dir: STRATEGIES_DIR });
    await store.initialize();

    const result = await syncFromFetched([makeFetched(validMarkdown, 'test.md')], store, DEFAULT_STRATEGY_SOURCE);

    expect(result.added).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(store.getById('test-strategy')).toBeDefined();
  });

  it('skips strategies that already exist', async () => {
    const store = new StrategyStore({ dir: STRATEGIES_DIR });
    await store.initialize();

    await syncFromFetched([makeFetched(validMarkdown, 'test.md')], store, DEFAULT_STRATEGY_SOURCE);
    const result = await syncFromFetched([makeFetched(validMarkdown, 'test.md')], store, DEFAULT_STRATEGY_SOURCE);

    expect(result.added).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('sets source to built-in for the default source', async () => {
    const store = new StrategyStore({ dir: STRATEGIES_DIR });
    await store.initialize();

    await syncFromFetched([makeFetched(validMarkdown, 'test.md')], store, DEFAULT_STRATEGY_SOURCE);
    const strategy = store.getById('test-strategy');
    expect(strategy?.source).toBe('built-in');
    expect(strategy?.createdBy).toBe('YojinHQ/trading-strategies');
  });

  it('sets source to community for non-default sources', async () => {
    const store = new StrategyStore({ dir: STRATEGIES_DIR });
    await store.initialize();

    const customSource = { ...DEFAULT_STRATEGY_SOURCE, id: 'alice/strats', owner: 'alice', repo: 'strats' };
    await syncFromFetched(
      [{ filename: 'test.md', markdown: validMarkdown, source: customSource }],
      store,
      customSource,
    );
    const strategy = store.getById('test-strategy');
    expect(strategy?.source).toBe('community');
    expect(strategy?.createdBy).toBe('alice/strats');
  });

  it('reports failed strategies with invalid markdown', async () => {
    const store = new StrategyStore({ dir: STRATEGIES_DIR });
    await store.initialize();

    const result = await syncFromFetched([makeFetched('not valid markdown', 'bad.md')], store, DEFAULT_STRATEGY_SOURCE);

    expect(result.added).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
  });

  it('processes multiple strategies in one batch', async () => {
    const store = new StrategyStore({ dir: STRATEGIES_DIR });
    await store.initialize();

    const result = await syncFromFetched(
      [makeFetched(validMarkdown, 'a.md'), makeFetched(validMarkdown2, 'b.md')],
      store,
      DEFAULT_STRATEGY_SOURCE,
    );

    expect(result.added).toBe(2);
    expect(store.getAll()).toHaveLength(2);
  });
});

describe('syncStrategies', () => {
  beforeEach(() => {
    vi.mocked(fetchStrategiesFromSource).mockReset();
    mkdirSync(STRATEGIES_DIR, { recursive: true });
  });

  it('syncs from multiple sources and aggregates results', async () => {
    const store = new StrategyStore({ dir: STRATEGIES_DIR });
    await store.initialize();

    const source1 = { ...DEFAULT_STRATEGY_SOURCE, id: 'a/b', owner: 'a', repo: 'b' };
    const source2 = { ...DEFAULT_STRATEGY_SOURCE, id: 'c/d', owner: 'c', repo: 'd' };

    vi.mocked(fetchStrategiesFromSource)
      .mockResolvedValueOnce({
        strategies: [{ filename: 'a.md', markdown: validMarkdown, source: source1 }],
        errors: [],
      })
      .mockResolvedValueOnce({
        strategies: [{ filename: 'b.md', markdown: validMarkdown2, source: source2 }],
        errors: [],
      });

    const result = await syncStrategies([source1, source2], store);
    expect(result.added).toBe(2);
    expect(result.errors).toHaveLength(0);
  });
});
