import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActionStore } from '../../src/actions/action-store.js';
import type { Action } from '../../src/actions/types.js';

function makeAction(overrides: Partial<Action> = {}): Action {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    what: 'Review AAPL — RSI oversold',
    why: 'RSI dropped below 30',
    source: 'skill: Bollinger Mean Reversion',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ActionStore', () => {
  let dir: string;
  let store: ActionStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'action-store-test-'));
    store = new ActionStore({ dir });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('dismiss', () => {
    it('sets dismissedAt on a pending action', async () => {
      const action = makeAction();
      await store.create(action);
      const result = await store.dismiss(action.id);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dismissedAt).toBeDefined();
        expect(result.data.id).toBe(action.id);
      }
    });

    it('returns error for non-existent action', async () => {
      const result = await store.dismiss('non-existent-id');
      expect(result.success).toBe(false);
    });

    it('dismissed actions are excluded from getPending', async () => {
      const action = makeAction();
      await store.create(action);
      await store.dismiss(action.id);
      const pending = await store.getPending();
      expect(pending).toHaveLength(0);
    });

    it('dismissed actions are excluded from query by default', async () => {
      const action = makeAction();
      await store.create(action);
      await store.dismiss(action.id);
      const results = await store.query({ status: 'PENDING' });
      expect(results).toHaveLength(0);
    });

    it('dismissed actions are included when dismissed=true', async () => {
      const action = makeAction();
      await store.create(action);
      await store.dismiss(action.id);
      const results = await store.query({ dismissed: true });
      expect(results).toHaveLength(1);
      expect(results[0].dismissedAt).toBeDefined();
    });
  });
});
