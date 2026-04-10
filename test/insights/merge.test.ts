import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DataBrief } from '../../src/insights/data-gatherer.js';
import { InsightStore } from '../../src/insights/insight-store.js';
import { mergeColdPositions } from '../../src/insights/merge.js';
import type { ColdPosition } from '../../src/insights/triage.js';
import type { InsightReport, PositionInsight } from '../../src/insights/types.js';

function makeInsight(symbol: string, overrides?: Partial<PositionInsight>): PositionInsight {
  return {
    symbol,
    name: symbol,
    rating: 'NEUTRAL',
    conviction: 0.7,
    thesis: `Thesis for ${symbol}`,
    keySignals: [],
    allSignalIds: [],
    risks: [],
    opportunities: [],
    memoryContext: null,
    priceTarget: null,
    ...overrides,
  };
}

function makeReport(positions: PositionInsight[], overrides?: Partial<InsightReport>): InsightReport {
  return {
    id: 'report-1',
    snapshotId: 'snap-1',
    positions,
    portfolio: {
      overallHealth: 'HEALTHY',
      summary: 'Test summary',
      sectorThemes: [],
      macroContext: '',
      topRisks: [],
      topOpportunities: [],
      actionItems: [],
    },
    agentOutputs: { researchAnalyst: '', riskManager: '', strategist: '' },
    emotionState: { confidence: 0.7, riskAppetite: 0.5, reason: '' },
    createdAt: new Date().toISOString(),
    durationMs: 1000,
    ...overrides,
  };
}

function makeBrief(symbol: string): DataBrief {
  return {
    symbol,
    name: symbol,
    quantity: 10,
    costBasis: 100,
    currentPrice: 100,
    marketValue: 1000,
    unrealizedPnlPercent: 0,
    sector: null,
    assetClass: 'equity',
    quotePrice: null,
    changePercent: null,
    volume: null,
    marketCap: null,
    pe: null,
    eps: null,
    enrichmentSector: null,
    riskScore: null,
    riskSignals: [],
    signalCount: 0,
    signals: [],
    sentimentDirection: 'NEUTRAL',
    memories: [],
  };
}

describe('mergeColdPositions', () => {
  let tmpDir: string;
  let store: InsightStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'yojin-merge-'));
    store = new InsightStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when no cold positions', async () => {
    const result = await mergeColdPositions(store, []);
    expect(result).toBeNull();
  });

  it('returns null when no report exists in store', async () => {
    const cold: ColdPosition[] = [{ brief: makeBrief('COLD'), previousInsight: makeInsight('COLD') }];
    const result = await mergeColdPositions(store, cold);
    expect(result).toBeNull();
  });

  it('merges cold positions with carriedForward flag', async () => {
    const report = makeReport([makeInsight('HOT1'), makeInsight('HOT2')]);
    await store.save(report);

    const cold: ColdPosition[] = [
      { brief: makeBrief('COLD1'), previousInsight: makeInsight('COLD1', { rating: 'BULLISH' }) },
      { brief: makeBrief('COLD2'), previousInsight: makeInsight('COLD2', { rating: 'BEARISH' }) },
    ];

    const merged = await mergeColdPositions(store, cold);

    expect(merged).not.toBeNull();
    expect(merged!.positions).toHaveLength(4);
    expect(merged!.id).toBe('report-1-merged');

    // Original positions are unchanged
    const hot1 = merged!.positions.find((p) => p.symbol === 'HOT1');
    expect(hot1?.carriedForward).toBeUndefined();

    // Cold positions are marked
    const cold1 = merged!.positions.find((p) => p.symbol === 'COLD1');
    expect(cold1?.carriedForward).toBe(true);
    expect(cold1?.rating).toBe('BULLISH');

    const cold2 = merged!.positions.find((p) => p.symbol === 'COLD2');
    expect(cold2?.carriedForward).toBe(true);
    expect(cold2?.rating).toBe('BEARISH');
  });

  it('skips cold positions already in the report', async () => {
    const report = makeReport([makeInsight('AAPL'), makeInsight('MSFT')]);
    await store.save(report);

    // AAPL is already in the report — should not be duplicated
    const cold: ColdPosition[] = [
      { brief: makeBrief('AAPL'), previousInsight: makeInsight('AAPL', { rating: 'VERY_BULLISH' }) },
      { brief: makeBrief('GOOG'), previousInsight: makeInsight('GOOG') },
    ];

    const merged = await mergeColdPositions(store, cold);

    expect(merged!.positions).toHaveLength(3); // AAPL, MSFT, GOOG
    const aaplPositions = merged!.positions.filter((p) => p.symbol === 'AAPL');
    expect(aaplPositions).toHaveLength(1);
    expect(aaplPositions[0].carriedForward).toBeUndefined(); // original, not carried forward
  });

  it('adds baseline insight for cold positions without previous insights', async () => {
    const report = makeReport([makeInsight('HOT')]);
    await store.save(report);

    const cold: ColdPosition[] = [
      { brief: makeBrief('NEW'), previousInsight: null }, // new position, no history
      { brief: makeBrief('OLD'), previousInsight: makeInsight('OLD') },
    ];

    const merged = await mergeColdPositions(store, cold);

    expect(merged!.positions).toHaveLength(3); // HOT + NEW (baseline) + OLD
    const newPos = merged!.positions.find((p) => p.symbol === 'NEW');
    expect(newPos).toBeDefined();
    expect(newPos!.carriedForward).toBe(true);
    expect(newPos!.rating).toBe('NEUTRAL');
    expect(newPos!.conviction).toBe(0.3);
    expect(newPos!.thesis).toBe('Awaiting deeper analysis — low recent activity.');
  });

  it('returns original report when all cold are already present', async () => {
    const report = makeReport([makeInsight('AAPL'), makeInsight('MSFT')]);
    await store.save(report);

    const cold: ColdPosition[] = [
      { brief: makeBrief('AAPL'), previousInsight: makeInsight('AAPL') },
      { brief: makeBrief('MSFT'), previousInsight: makeInsight('MSFT') },
    ];

    const merged = await mergeColdPositions(store, cold);

    // Should return original since no new positions were added
    expect(merged!.positions).toHaveLength(2);
    expect(merged!.id).toBe('report-1'); // no -merged suffix
  });

  it('saves merged report to store', async () => {
    const report = makeReport([makeInsight('HOT')]);
    await store.save(report);

    const cold: ColdPosition[] = [{ brief: makeBrief('COLD'), previousInsight: makeInsight('COLD') }];

    await mergeColdPositions(store, cold);

    // Store should now have 2 entries: original + merged
    const all = await store.getAll();
    expect(all).toHaveLength(2);
    expect(all[1].id).toBe('report-1-merged');
    expect(all[1].positions).toHaveLength(2);
  });
});
