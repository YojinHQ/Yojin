import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AlertStore } from '../../src/alerts/alert-store.js';
import type { Alert } from '../../src/alerts/types.js';

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: `alert-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    insightId: `micro-${Date.now()}`,
    symbol: 'AAPL',
    severity: 0.85,
    severityLabel: 'HIGH',
    thesis: 'Significant earnings beat',
    keyDevelopments: ['Revenue up 15%', 'New product launch'],
    rating: 'VERY_BULLISH',
    sentiment: 'BULLISH',
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('AlertStore', () => {
  let dir: string;
  let store: AlertStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'alert-store-'));
    store = new AlertStore({ dir });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates and queries an alert', async () => {
    const alert = makeAlert();
    const result = await store.create(alert);
    expect(result.success).toBe(true);

    const queried = await store.query();
    expect(queried).toHaveLength(1);
    expect(queried[0].id).toBe(alert.id);
    expect(queried[0].symbol).toBe('AAPL');
  });

  it('dismisses an active alert', async () => {
    const alert = makeAlert();
    await store.create(alert);

    const result = await store.dismiss(alert.id);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('DISMISSED');
      expect(result.data.dismissedAt).toBeDefined();
    }
  });

  it('returns error when dismissing non-existent alert', async () => {
    const result = await store.dismiss('non-existent');
    expect(result.success).toBe(false);
  });

  it('returns error when dismissing already dismissed alert', async () => {
    const alert = makeAlert();
    await store.create(alert);
    await store.dismiss(alert.id);

    const result = await store.dismiss(alert.id);
    expect(result.success).toBe(false);
  });

  it('filters by status', async () => {
    const active = makeAlert({ id: 'a1' });
    const dismissed = makeAlert({ id: 'a2' });
    await store.create(active);
    await store.create(dismissed);
    await store.dismiss('a2');

    const activeOnly = await store.query({ status: 'ACTIVE' });
    expect(activeOnly).toHaveLength(1);
    expect(activeOnly[0].id).toBe('a1');

    const dismissedOnly = await store.query({ status: 'DISMISSED' });
    expect(dismissedOnly).toHaveLength(1);
    expect(dismissedOnly[0].id).toBe('a2');
  });

  it('deduplicates by insightId', async () => {
    const alert = makeAlert({ insightId: 'micro-123' });
    await store.create(alert);

    const exists = await store.hasAlertForInsight('micro-123');
    expect(exists).toBe(true);

    const notExists = await store.hasAlertForInsight('micro-999');
    expect(notExists).toBe(false);
  });

  it('finds latest active alert for ticker within window', async () => {
    const alert = makeAlert({ symbol: 'TSLA' });
    await store.create(alert);

    const found = await store.getLatestActiveForTicker('TSLA', 60_000);
    expect(found).not.toBeNull();
    expect(found?.symbol).toBe('TSLA');

    const notFound = await store.getLatestActiveForTicker('GOOG', 60_000);
    expect(notFound).toBeNull();
  });

  it('respects the limit in query', async () => {
    for (let i = 0; i < 5; i++) {
      await store.create(makeAlert({ id: `alert-${i}` }));
    }

    const limited = await store.query({ limit: 3 });
    expect(limited).toHaveLength(3);
  });

  it('getById returns the latest version after dismiss', async () => {
    const alert = makeAlert();
    await store.create(alert);
    await store.dismiss(alert.id);

    const found = await store.getById(alert.id);
    expect(found?.status).toBe('DISMISSED');
  });
});
