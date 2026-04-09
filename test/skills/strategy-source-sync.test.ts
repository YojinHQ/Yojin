import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SkillStore } from '../../src/skills/skill-store.js';
import type { FetchedStrategy } from '../../src/skills/strategy-source-fetcher.js';
import { syncFromFetched } from '../../src/skills/strategy-source-sync.js';
import { DEFAULT_STRATEGY_SOURCE } from '../../src/skills/strategy-source-types.js';

const TEST_DIR = join(import.meta.dirname, '.tmp-sync-test');
const SKILLS_DIR = join(TEST_DIR, 'skills');

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
style: risk
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
  mkdirSync(SKILLS_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('syncFromFetched', () => {
  it('saves new strategies and returns added count', async () => {
    const store = new SkillStore({ dir: SKILLS_DIR });
    await store.initialize();

    const result = await syncFromFetched([makeFetched(validMarkdown, 'test.md')], store, DEFAULT_STRATEGY_SOURCE);

    expect(result.added).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(store.getById('test-strategy')).toBeDefined();
  });

  it('skips strategies that already exist', async () => {
    const store = new SkillStore({ dir: SKILLS_DIR });
    await store.initialize();

    await syncFromFetched([makeFetched(validMarkdown, 'test.md')], store, DEFAULT_STRATEGY_SOURCE);
    const result = await syncFromFetched([makeFetched(validMarkdown, 'test.md')], store, DEFAULT_STRATEGY_SOURCE);

    expect(result.added).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('sets source to built-in for the default source', async () => {
    const store = new SkillStore({ dir: SKILLS_DIR });
    await store.initialize();

    await syncFromFetched([makeFetched(validMarkdown, 'test.md')], store, DEFAULT_STRATEGY_SOURCE);
    const skill = store.getById('test-strategy');
    expect(skill?.source).toBe('built-in');
    expect(skill?.createdBy).toBe('YojinHQ/trading-strategies');
  });

  it('sets source to community for non-default sources', async () => {
    const store = new SkillStore({ dir: SKILLS_DIR });
    await store.initialize();

    const customSource = { ...DEFAULT_STRATEGY_SOURCE, id: 'alice/strats', owner: 'alice', repo: 'strats' };
    await syncFromFetched(
      [{ filename: 'test.md', markdown: validMarkdown, source: customSource }],
      store,
      customSource,
    );
    const skill = store.getById('test-strategy');
    expect(skill?.source).toBe('community');
    expect(skill?.createdBy).toBe('alice/strats');
  });

  it('reports failed strategies with invalid markdown', async () => {
    const store = new SkillStore({ dir: SKILLS_DIR });
    await store.initialize();

    const result = await syncFromFetched([makeFetched('not valid markdown', 'bad.md')], store, DEFAULT_STRATEGY_SOURCE);

    expect(result.added).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
  });

  it('processes multiple strategies in one batch', async () => {
    const store = new SkillStore({ dir: SKILLS_DIR });
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
