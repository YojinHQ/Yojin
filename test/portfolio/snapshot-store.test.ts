import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Position } from '../../src/api/graphql/types.js';
import { PortfolioSnapshotStore } from '../../src/portfolio/snapshot-store.js';

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

  describe('getFirstSeenMap', () => {
    it('returns empty map when no snapshots exist', async () => {
      const result = await store.getFirstSeenMap();
      expect(result.firstSeenBySymbol.size).toBe(0);
      expect(result.overallFirstDate).toBeNull();
    });

    it('reports earliest day a symbol appeared and overall first snapshot day', async () => {
      await store.save({ positions: [TEST_POSITIONS[0]], platform: 'INTERACTIVE_BROKERS' });
      await new Promise((r) => setTimeout(r, 5));
      await store.save({ positions: TEST_POSITIONS, platform: 'COINBASE' });

      const { firstSeenBySymbol, overallFirstDate } = await store.getFirstSeenMap();
      const today = new Date().toISOString().slice(0, 10);

      expect(overallFirstDate).toBe(today);
      expect(firstSeenBySymbol.get('AAPL')).toBe(today);
      expect(firstSeenBySymbol.get('BTC')).toBe(today);
    });

    it('distinguishes new-addition from originally-held when snapshots span multiple days', async () => {
      // Simulate two snapshots on different calendar days by hand-appending lines.
      const { appendFile, mkdir } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const path = join(tmpDir, 'snapshots', 'portfolio.jsonl');
      await mkdir(join(tmpDir, 'snapshots'), { recursive: true });

      const oldSnap = {
        id: 'snap-old',
        positions: [{ ...TEST_POSITIONS[0], platform: 'INTERACTIVE_BROKERS' }],
        totalValue: 100,
        totalCost: 100,
        totalPnl: 0,
        totalPnlPercent: 0,
        totalDayChange: 0,
        totalDayChangePercent: 0,
        timestamp: '2026-04-01T12:00:00.000Z',
        platform: null,
      };
      const newSnap = {
        ...oldSnap,
        id: 'snap-new',
        positions: [...oldSnap.positions, { ...TEST_POSITIONS[1], platform: 'COINBASE' }],
        timestamp: '2026-04-15T12:00:00.000Z',
      };

      await appendFile(path, JSON.stringify(oldSnap) + '\n' + JSON.stringify(newSnap) + '\n');

      const { firstSeenBySymbol, overallFirstDate } = await store.getFirstSeenMap();

      expect(overallFirstDate).toBe('2026-04-01');
      expect(firstSeenBySymbol.get('AAPL')).toBe('2026-04-01');
      expect(firstSeenBySymbol.get('BTC')).toBe('2026-04-15');
    });
  });

  describe('cash balances', () => {
    it('defaults to empty cashBalances on save', async () => {
      const snap = await store.save({ positions: TEST_POSITIONS, platform: 'INTERACTIVE_BROKERS' });
      expect(snap.cashBalances).toEqual([]);
    });

    it('setCashBalance upserts a (platform, currency) pair', async () => {
      const snap = await store.setCashBalance({ platform: 'ROBINHOOD', currency: 'USD', amount: 1500 });
      expect(snap.cashBalances).toHaveLength(1);
      expect(snap.cashBalances[0]).toEqual({ platform: 'ROBINHOOD', currency: 'USD', amount: 1500 });
    });

    it('setCashBalance updates the existing entry for the same (platform, currency)', async () => {
      await store.setCashBalance({ platform: 'ROBINHOOD', currency: 'USD', amount: 1500 });
      const snap = await store.setCashBalance({ platform: 'ROBINHOOD', currency: 'USD', amount: 2500 });
      expect(snap.cashBalances).toHaveLength(1);
      expect(snap.cashBalances[0].amount).toBe(2500);
    });

    it('setCashBalance keeps entries for other platforms or currencies', async () => {
      await store.setCashBalance({ platform: 'ROBINHOOD', currency: 'USD', amount: 1000 });
      await store.setCashBalance({ platform: 'COINBASE', currency: 'USD', amount: 500 });
      const snap = await store.setCashBalance({ platform: 'ROBINHOOD', currency: 'EUR', amount: 200 });

      expect(snap.cashBalances).toHaveLength(3);
      const keys = snap.cashBalances.map((b) => `${b.platform}|${b.currency}`).sort();
      expect(keys).toEqual(['COINBASE|USD', 'ROBINHOOD|EUR', 'ROBINHOOD|USD']);
    });

    it('setCashBalance uppercases platform and currency', async () => {
      const snap = await store.setCashBalance({ platform: 'robinhood', currency: 'usd', amount: 100 });
      expect(snap.cashBalances[0].platform).toBe('ROBINHOOD');
      expect(snap.cashBalances[0].currency).toBe('USD');
    });

    it('setCashBalance rejects negative amounts', async () => {
      await expect(store.setCashBalance({ platform: 'ROBINHOOD', currency: 'USD', amount: -1 })).rejects.toThrow(
        /non-negative/,
      );
    });

    it('setCashBalance rejects non-finite amounts', async () => {
      await expect(
        store.setCashBalance({ platform: 'ROBINHOOD', currency: 'USD', amount: Number.NaN }),
      ).rejects.toThrow(/non-negative/);
    });

    it('setCashBalance rejects non-ISO currency codes', async () => {
      await expect(store.setCashBalance({ platform: 'ROBINHOOD', currency: 'DOLLARS', amount: 100 })).rejects.toThrow(
        /3-letter ISO/,
      );
    });

    it('removeCashBalance removes only the matching (platform, currency)', async () => {
      await store.setCashBalance({ platform: 'ROBINHOOD', currency: 'USD', amount: 1000 });
      await store.setCashBalance({ platform: 'COINBASE', currency: 'USD', amount: 500 });
      const snap = await store.removeCashBalance({ platform: 'ROBINHOOD', currency: 'USD' });

      expect(snap.cashBalances).toHaveLength(1);
      expect(snap.cashBalances[0].platform).toBe('COINBASE');
    });

    it('removeCashBalance is a no-op for a missing key but still appends a snapshot', async () => {
      await store.setCashBalance({ platform: 'ROBINHOOD', currency: 'USD', amount: 1000 });
      const snap = await store.removeCashBalance({ platform: 'COINBASE', currency: 'USD' });
      expect(snap.cashBalances).toHaveLength(1);
    });

    it('preserves positions when only cash changes', async () => {
      await store.save({ positions: TEST_POSITIONS, platform: 'INTERACTIVE_BROKERS' });
      const snap = await store.setCashBalance({ platform: 'ROBINHOOD', currency: 'USD', amount: 1500 });

      expect(snap.positions).toHaveLength(2);
      expect(snap.positions.map((p) => p.symbol).sort()).toEqual(['AAPL', 'BTC']);
    });

    it('preserves cash when positions are saved', async () => {
      await store.setCashBalance({ platform: 'ROBINHOOD', currency: 'USD', amount: 1500 });
      const snap = await store.save({ positions: TEST_POSITIONS, platform: 'INTERACTIVE_BROKERS' });

      expect(snap.cashBalances).toHaveLength(1);
      expect(snap.cashBalances[0].amount).toBe(1500);
    });

    it('getLatest back-fills cashBalances=[] for snapshots persisted before the field existed', async () => {
      const { appendFile, mkdir } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const path = join(tmpDir, 'snapshots', 'portfolio.jsonl');
      await mkdir(join(tmpDir, 'snapshots'), { recursive: true });

      const legacy = {
        id: 'snap-legacy',
        positions: [],
        totalValue: 0,
        totalCost: 0,
        totalPnl: 0,
        totalPnlPercent: 0,
        totalDayChange: 0,
        totalDayChangePercent: 0,
        timestamp: '2026-04-01T12:00:00.000Z',
        platform: null,
      };
      await appendFile(path, JSON.stringify(legacy) + '\n');

      const latest = await store.getLatest();
      expect(latest).not.toBeNull();
      expect(latest!.cashBalances).toEqual([]);
    });
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
