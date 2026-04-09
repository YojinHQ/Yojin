/**
 * ActionStore tests — focused on the supersede path used by the micro
 * priority gate.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ActionStore } from '../../src/actions/action-store.js';
import type { Action } from '../../src/actions/types.js';

function makeAction(overrides: Partial<Action> = {}): Action {
  const now = new Date().toISOString();
  return {
    id: `a-${Math.random().toString(36).slice(2, 10)}`,
    what: 'Review AAPL',
    why: 'unit test',
    source: 'micro-observation: AAPL',
    severity: 0.5,
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    createdAt: now,
    ...overrides,
  };
}

describe('ActionStore.supersede', () => {
  let dir: string;
  let store: ActionStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'action-store-test-'));
    store = new ActionStore({ dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('marks a pending action as EXPIRED with resolvedBy=superseded', async () => {
    const action = makeAction();
    await store.create(action);

    const result = await store.supersede(action.id);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.status).toBe('EXPIRED');
    expect(result.data.resolvedBy).toBe('superseded');
    expect(result.data.resolvedAt).toBeDefined();
  });

  it('refuses to supersede an already-resolved action', async () => {
    const action = makeAction();
    await store.create(action);
    await store.approve(action.id);

    const result = await store.supersede(action.id);
    expect(result.success).toBe(false);
  });

  it('superseded actions no longer appear in getPending', async () => {
    const a = makeAction({ id: 'a-1', severity: 0.3 });
    const b = makeAction({ id: 'a-2', severity: 0.9 });
    await store.create(a);
    await store.create(b);

    await store.supersede('a-1');

    const pending = await store.getPending();
    expect(pending.map((p) => p.id)).toEqual(['a-2']);
  });

  it('persists the severity score on create/query roundtrip', async () => {
    await store.create(makeAction({ id: 'a-sev', severity: 0.72 }));
    const pending = await store.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].severity).toBe(0.72);
  });
});
