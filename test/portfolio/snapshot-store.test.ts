import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Position } from '../../src/api/graphql/types.js';
import { PortfolioSnapshotStore } from '../../src/portfolio/snapshot-store.js';
import { DefaultPiiRedactor } from '../../src/trust/pii/redactor.js';

const TEST_POSITIONS: Position[] = [
  {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    quantity: 50,
    costBasis: 145.0,
    currentPrice: 178.5,
    marketValue: 8925.0,
    unrealizedPnl: 1675.0,
    unrealizedPnlPercent: 23.1,
    sector: 'Technology',
    assetClass: 'EQUITY',
    platform: 'INTERACTIVE_BROKERS',
  },
  {
    symbol: 'BTC',
    name: 'Bitcoin',
    quantity: 0.5,
    costBasis: 42000.0,
    currentPrice: 67500.0,
    marketValue: 33750.0,
    unrealizedPnl: 12750.0,
    unrealizedPnlPercent: 60.71,
    assetClass: 'CRYPTO',
    platform: 'COINBASE',
  },
];

describe('PortfolioSnapshotStore', () => {
  let tmpDir: string;
  let store: PortfolioSnapshotStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'yojin-snapshot-'));
    store = new PortfolioSnapshotStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when no snapshots exist', async () => {
    const latest = await store.getLatest();
    expect(latest).toBeNull();
  });

  it('returns empty array from getAll when no snapshots exist', async () => {
    const all = await store.getAll();
    expect(all).toEqual([]);
  });

  it('saves and retrieves a snapshot', async () => {
    const snapshot = await store.save({
      positions: TEST_POSITIONS,
      platform: 'INTERACTIVE_BROKERS',
    });

    expect(snapshot.id).toMatch(/^snap-/);
    expect(snapshot.positions).toHaveLength(2);
    expect(snapshot.platform).toBe('INTERACTIVE_BROKERS');
    expect(snapshot.totalValue).toBe(8925.0 + 33750.0);
    expect(snapshot.timestamp).toBeDefined();

    const latest = await store.getLatest();
    expect(latest).toEqual(snapshot);
  });

  it('computes totals correctly', async () => {
    const snapshot = await store.save({
      positions: TEST_POSITIONS,
      platform: 'COINBASE',
    });

    const totalValue = 8925.0 + 33750.0;
    const totalPnl = 1675.0 + 12750.0;
    const totalCost = totalValue - totalPnl;
    expect(snapshot.totalValue).toBe(totalValue);
    expect(snapshot.totalPnl).toBe(totalPnl);
    expect(snapshot.totalCost).toBe(totalCost);
  });

  it('getLatest returns the most recent snapshot', async () => {
    await store.save({ positions: [TEST_POSITIONS[0]], platform: 'INTERACTIVE_BROKERS' });
    const second = await store.save({ positions: TEST_POSITIONS, platform: 'COINBASE' });

    const latest = await store.getLatest();
    expect(latest?.id).toBe(second.id);
    expect(latest?.positions).toHaveLength(2);
  });

  it('getAll returns all snapshots in order', async () => {
    await store.save({ positions: [TEST_POSITIONS[0]], platform: 'INTERACTIVE_BROKERS' });
    await store.save({ positions: TEST_POSITIONS, platform: 'COINBASE' });

    const all = await store.getAll();
    expect(all).toHaveLength(2);
    expect(all[0].positions).toHaveLength(1);
    expect(all[1].positions).toHaveLength(2);
  });

  it('getLatestRedacted returns snapshot with balances converted to ranges', async () => {
    await store.save({ positions: TEST_POSITIONS, platform: 'COINBASE' });

    const noopAuditLog = { append: () => {} };
    const redactor = new DefaultPiiRedactor({ auditLog: noopAuditLog as never });
    const redacted = await store.getLatestRedacted(redactor);

    expect(redacted).not.toBeNull();
    // Balance fields should be converted to range strings, not exact numbers
    expect(typeof redacted!.totalValue).toBe('string');
    expect(redacted!.totalValue).toMatch(/^\$/); // e.g. "$10k-$50k"
    expect(typeof redacted!.totalCost).toBe('string');
    expect(redacted!.totalCost).toMatch(/^\$/);
    expect(typeof redacted!.totalPnl).toBe('string');
    expect(redacted!.totalPnl).toMatch(/^-?\$/); // e.g. "$10k-$50k" or "-$50k-$100k"
    // Position-level balances should also be redacted
    const pos = redacted!.positions[0];
    expect(typeof pos.marketValue).toBe('string');
    expect(typeof pos.costBasis).toBe('string');
    expect(typeof pos.unrealizedPnl).toBe('string');
    // currentPrice and quantity should be stripped to prevent balance reconstruction
    expect(pos).not.toHaveProperty('currentPrice');
    expect(pos).not.toHaveProperty('quantity');
  });
});
