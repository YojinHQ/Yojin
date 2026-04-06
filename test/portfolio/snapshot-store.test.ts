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

  it('saves and retrieves a snapshot', async () => {
    const snapshot = await store.save({
      positions: TEST_POSITIONS,
      platform: 'INTERACTIVE_BROKERS',
    });

    expect(snapshot.id).toMatch(/^snap-/);
    expect(snapshot.positions).toHaveLength(2);
    expect(snapshot.platform).toBeNull();
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
    expect(latest?.positions).toHaveLength(3);
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

  it('save merges by platform — saving MANUAL preserves ROBINHOOD positions', async () => {
    const robinhoodPositions: Position[] = [
      {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        quantity: 10,
        costBasis: 150,
        currentPrice: 178,
        marketValue: 1780,
        unrealizedPnl: 280,
        unrealizedPnlPercent: 18.67,
        assetClass: 'EQUITY',
        platform: 'ROBINHOOD',
      },
    ];

    const manualPositions: Position[] = [
      {
        symbol: 'MSFT',
        name: 'Microsoft',
        quantity: 5,
        costBasis: 300,
        currentPrice: 420,
        marketValue: 2100,
        unrealizedPnl: 600,
        unrealizedPnlPercent: 40,
        assetClass: 'EQUITY',
        platform: 'MANUAL',
      },
    ];

    await store.save({ positions: robinhoodPositions, platform: 'ROBINHOOD' });
    await store.save({ positions: manualPositions, platform: 'MANUAL' });

    const latest = await store.getLatest();
    expect(latest!.positions).toHaveLength(2);
    expect(latest!.positions.map((p) => p.symbol).sort()).toEqual(['AAPL', 'MSFT']);
    expect(latest!.positions.find((p) => p.symbol === 'AAPL')!.platform).toBe('ROBINHOOD');
    expect(latest!.positions.find((p) => p.symbol === 'MSFT')!.platform).toBe('MANUAL');
  });

  it('save replaces positions for the same platform, preserves others', async () => {
    const robinhoodV1: Position[] = [
      {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        quantity: 10,
        costBasis: 150,
        currentPrice: 178,
        marketValue: 1780,
        unrealizedPnl: 280,
        unrealizedPnlPercent: 18.67,
        assetClass: 'EQUITY',
        platform: 'ROBINHOOD',
      },
    ];

    const manualPositions: Position[] = [
      {
        symbol: 'MSFT',
        name: 'Microsoft',
        quantity: 5,
        costBasis: 300,
        currentPrice: 420,
        marketValue: 2100,
        unrealizedPnl: 600,
        unrealizedPnlPercent: 40,
        assetClass: 'EQUITY',
        platform: 'MANUAL',
      },
    ];

    const robinhoodV2: Position[] = [
      {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        quantity: 15,
        costBasis: 150,
        currentPrice: 180,
        marketValue: 2700,
        unrealizedPnl: 450,
        unrealizedPnlPercent: 20,
        assetClass: 'EQUITY',
        platform: 'ROBINHOOD',
      },
      {
        symbol: 'GOOG',
        name: 'Alphabet',
        quantity: 3,
        costBasis: 140,
        currentPrice: 175,
        marketValue: 525,
        unrealizedPnl: 105,
        unrealizedPnlPercent: 25,
        assetClass: 'EQUITY',
        platform: 'ROBINHOOD',
      },
    ];

    await store.save({ positions: robinhoodV1, platform: 'ROBINHOOD' });
    await store.save({ positions: manualPositions, platform: 'MANUAL' });
    await store.save({ positions: robinhoodV2, platform: 'ROBINHOOD' });

    const latest = await store.getLatest();
    expect(latest!.positions).toHaveLength(3);
    expect(latest!.positions.find((p) => p.symbol === 'MSFT')!.platform).toBe('MANUAL');
    expect(latest!.positions.find((p) => p.symbol === 'AAPL')!.quantity).toBe(15);
    expect(latest!.positions.find((p) => p.symbol === 'GOOG')!.platform).toBe('ROBINHOOD');
  });

  it('snapshot-level platform is null (multi-platform)', async () => {
    await store.save({
      positions: [
        {
          symbol: 'AAPL',
          name: 'Apple',
          quantity: 1,
          costBasis: 100,
          currentPrice: 100,
          marketValue: 100,
          unrealizedPnl: 0,
          unrealizedPnlPercent: 0,
          assetClass: 'EQUITY',
          platform: 'ROBINHOOD',
        },
      ],
      platform: 'ROBINHOOD',
    });

    const latest = await store.getLatest();
    expect(latest!.platform).toBeNull();
  });

  it('totals are recomputed from all merged positions', async () => {
    await store.save({
      positions: [
        {
          symbol: 'AAPL',
          name: 'Apple',
          quantity: 10,
          costBasis: 150,
          currentPrice: 178,
          marketValue: 1780,
          unrealizedPnl: 280,
          unrealizedPnlPercent: 18.67,
          assetClass: 'EQUITY',
          platform: 'ROBINHOOD',
        },
      ],
      platform: 'ROBINHOOD',
    });
    await store.save({
      positions: [
        {
          symbol: 'BTC',
          name: 'Bitcoin',
          quantity: 1,
          costBasis: 60000,
          currentPrice: 67000,
          marketValue: 67000,
          unrealizedPnl: 7000,
          unrealizedPnlPercent: 11.67,
          assetClass: 'CRYPTO',
          platform: 'COINBASE',
        },
      ],
      platform: 'COINBASE',
    });

    const latest = await store.getLatest();
    expect(latest!.totalValue).toBe(1780 + 67000);
    expect(latest!.totalPnl).toBe(280 + 7000);
  });

  it('saving empty positions for a platform removes that platform', async () => {
    await store.save({
      positions: [
        {
          symbol: 'AAPL',
          name: 'Apple',
          quantity: 10,
          costBasis: 150,
          currentPrice: 178,
          marketValue: 1780,
          unrealizedPnl: 280,
          unrealizedPnlPercent: 18.67,
          assetClass: 'EQUITY',
          platform: 'ROBINHOOD',
        },
      ],
      platform: 'ROBINHOOD',
    });
    await store.save({
      positions: [
        {
          symbol: 'BTC',
          name: 'Bitcoin',
          quantity: 1,
          costBasis: 60000,
          currentPrice: 67000,
          marketValue: 67000,
          unrealizedPnl: 7000,
          unrealizedPnlPercent: 11.67,
          assetClass: 'CRYPTO',
          platform: 'COINBASE',
        },
      ],
      platform: 'COINBASE',
    });

    await store.save({ positions: [], platform: 'ROBINHOOD' });

    const latest = await store.getLatest();
    expect(latest!.positions).toHaveLength(1);
    expect(latest!.positions[0].symbol).toBe('BTC');
  });

  it('getPositionTimeline returns earliest date per symbol', async () => {
    await store.save({
      positions: [
        {
          symbol: 'AAPL',
          name: 'Apple',
          quantity: 10,
          costBasis: 150,
          currentPrice: 178,
          marketValue: 1780,
          unrealizedPnl: 280,
          unrealizedPnlPercent: 18.67,
          assetClass: 'EQUITY',
          platform: 'MANUAL',
        },
      ],
      platform: 'MANUAL',
    });
    await store.save({
      positions: [
        {
          symbol: 'AAPL',
          name: 'Apple',
          quantity: 10,
          costBasis: 150,
          currentPrice: 178,
          marketValue: 1780,
          unrealizedPnl: 280,
          unrealizedPnlPercent: 18.67,
          assetClass: 'EQUITY',
          platform: 'MANUAL',
        },
        {
          symbol: 'BTC',
          name: 'Bitcoin',
          quantity: 1,
          costBasis: 60000,
          currentPrice: 67000,
          marketValue: 67000,
          unrealizedPnl: 7000,
          unrealizedPnlPercent: 11.67,
          assetClass: 'CRYPTO',
          platform: 'COINBASE',
        },
      ],
      platform: 'COINBASE',
    });

    const timeline = await store.getPositionTimeline(['AAPL', 'BTC']);

    expect(timeline.size).toBe(2);
    expect(timeline.get('AAPL')).toBeDefined();
    expect(timeline.get('BTC')).toBeDefined();
    expect(timeline.get('AAPL')! <= timeline.get('BTC')!).toBe(true);
  });

  it('getPositionTimeline returns empty map when no snapshots exist', async () => {
    const timeline = await store.getPositionTimeline(['AAPL']);
    expect(timeline.size).toBe(0);
  });

  it('getPositionTimeline stops early once all symbols found', async () => {
    await store.save({
      positions: [
        {
          symbol: 'AAPL',
          name: 'Apple',
          quantity: 10,
          costBasis: 150,
          currentPrice: 178,
          marketValue: 1780,
          unrealizedPnl: 280,
          unrealizedPnlPercent: 18.67,
          assetClass: 'EQUITY',
          platform: 'MANUAL',
        },
      ],
      platform: 'MANUAL',
    });
    await store.save({
      positions: [
        {
          symbol: 'AAPL',
          name: 'Apple',
          quantity: 10,
          costBasis: 150,
          currentPrice: 180,
          marketValue: 1800,
          unrealizedPnl: 300,
          unrealizedPnlPercent: 20,
          assetClass: 'EQUITY',
          platform: 'MANUAL',
        },
      ],
      platform: 'MANUAL',
    });

    const timeline = await store.getPositionTimeline(['AAPL']);
    expect(timeline.size).toBe(1);
    expect(timeline.get('AAPL')).toBeDefined();
  });

  it('MANUAL same-symbol update preserves other platforms (simulates addManualPosition flow)', async () => {
    // Save ROBINHOOD position
    await store.save({
      positions: [
        {
          symbol: 'AAPL',
          name: 'Apple Inc.',
          quantity: 10,
          costBasis: 150,
          currentPrice: 178,
          marketValue: 1780,
          unrealizedPnl: 280,
          unrealizedPnlPercent: 18.67,
          assetClass: 'EQUITY',
          platform: 'ROBINHOOD',
        },
      ],
      platform: 'ROBINHOOD',
    });

    // First MANUAL save: MSFT qty 5
    await store.save({
      positions: [
        {
          symbol: 'MSFT',
          name: 'Microsoft',
          quantity: 5,
          costBasis: 300,
          currentPrice: 420,
          marketValue: 2100,
          unrealizedPnl: 600,
          unrealizedPnlPercent: 40,
          assetClass: 'EQUITY',
          platform: 'MANUAL',
        },
      ],
      platform: 'MANUAL',
    });

    // Second MANUAL save: MSFT qty 10 (simulates resolver dedup — passes full MANUAL set)
    await store.save({
      positions: [
        {
          symbol: 'MSFT',
          name: 'Microsoft',
          quantity: 10,
          costBasis: 300,
          currentPrice: 420,
          marketValue: 4200,
          unrealizedPnl: 1200,
          unrealizedPnlPercent: 40,
          assetClass: 'EQUITY',
          platform: 'MANUAL',
        },
      ],
      platform: 'MANUAL',
    });

    const latest = await store.getLatest();
    expect(latest!.positions).toHaveLength(2);
    // ROBINHOOD preserved
    expect(latest!.positions.find((p) => p.symbol === 'AAPL')!.platform).toBe('ROBINHOOD');
    // MANUAL updated — latest quantity wins
    expect(latest!.positions.find((p) => p.symbol === 'MSFT')!.quantity).toBe(10);
    expect(latest!.positions.find((p) => p.symbol === 'MSFT')!.platform).toBe('MANUAL');
  });
});
