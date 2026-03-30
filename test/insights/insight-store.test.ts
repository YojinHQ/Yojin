import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InsightStore } from '../../src/insights/insight-store.js';
import type { InsightReport } from '../../src/insights/types.js';

function makeReport(overrides?: Partial<InsightReport>): InsightReport {
  return {
    id: `insight-${Date.now()}`,
    snapshotId: 'snap-abc12345',
    positions: [
      {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        rating: 'BULLISH',
        conviction: 0.8,
        thesis: 'Strong earnings momentum with expanding services revenue.',
        keySignals: [
          {
            signalId: 'sig-001',
            type: 'FUNDAMENTAL',
            title: 'Q4 earnings beat estimates',
            impact: 'POSITIVE',
            confidence: 0.9,
            sourceCount: 1,
            outputType: 'INSIGHT',
          },
        ],
        allSignalIds: [],
        risks: ['Regulatory pressure in EU'],
        opportunities: ['AI integration in consumer products'],
        memoryContext: 'Previously bullish call on AAPL was correct (Q3 2025).',
        priceTarget: 210,
      },
    ],
    portfolio: {
      overallHealth: 'HEALTHY',
      summary: 'Portfolio is well-positioned with strong equity performance.',
      intelSummary: '',
      sectorThemes: ['Tech leadership', 'Crypto recovery'],
      macroContext: 'Fed holding rates steady, soft landing expected.',
      topRisks: [{ text: 'Concentration in tech sector', signalIds: [] }],
      topOpportunities: [{ text: 'Emerging market exposure', signalIds: [] }],
      actionItems: [{ text: 'Consider diversifying into healthcare', signalIds: [] }],
    },
    agentOutputs: {
      researchAnalyst: 'Research analyst output text',
      riskManager: 'Risk manager output text',
      strategist: 'Strategist synthesis text',
    },
    emotionState: {
      confidence: 0.75,
      riskAppetite: 0.6,
      reason: 'Positive earnings season, moderate macro uncertainty.',
    },
    createdAt: new Date().toISOString(),
    durationMs: 15000,
    ...overrides,
  };
}

describe('InsightStore', () => {
  let tmpDir: string;
  let store: InsightStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'yojin-insights-'));
    store = new InsightStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when no reports exist', async () => {
    const latest = await store.getLatest();
    expect(latest).toBeNull();
  });

  it('returns empty array from getAll when no reports exist', async () => {
    const all = await store.getAll();
    expect(all).toEqual([]);
  });

  it('saves and retrieves a report', async () => {
    const report = makeReport();
    await store.save(report);

    const latest = await store.getLatest();
    expect(latest).toEqual(report);
  });

  it('getLatest returns the most recent report', async () => {
    const first = makeReport({ id: 'insight-first' });
    const second = makeReport({ id: 'insight-second' });

    await store.save(first);
    await store.save(second);

    const latest = await store.getLatest();
    expect(latest?.id).toBe('insight-second');
  });

  it('getAll returns all reports in order', async () => {
    const first = makeReport({ id: 'insight-1' });
    const second = makeReport({ id: 'insight-2' });
    const third = makeReport({ id: 'insight-3' });

    await store.save(first);
    await store.save(second);
    await store.save(third);

    const all = await store.getAll();
    expect(all).toHaveLength(3);
    expect(all[0].id).toBe('insight-1');
    expect(all[1].id).toBe('insight-2');
    expect(all[2].id).toBe('insight-3');
  });

  it('getById finds a specific report', async () => {
    const target = makeReport({ id: 'insight-target' });
    await store.save(makeReport({ id: 'insight-other' }));
    await store.save(target);

    const found = await store.getById('insight-target');
    expect(found).toEqual(target);
  });

  it('getById returns null for unknown ID', async () => {
    await store.save(makeReport());
    const found = await store.getById('nonexistent');
    expect(found).toBeNull();
  });

  it('getBySnapshotId filters by snapshot', async () => {
    await store.save(makeReport({ id: 'r1', snapshotId: 'snap-aaa' }));
    await store.save(makeReport({ id: 'r2', snapshotId: 'snap-bbb' }));
    await store.save(makeReport({ id: 'r3', snapshotId: 'snap-aaa' }));

    const results = await store.getBySnapshotId('snap-aaa');
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.id)).toEqual(['r1', 'r3']);
  });

  it('getRecent returns the last N reports', async () => {
    for (let i = 0; i < 5; i++) {
      await store.save(makeReport({ id: `insight-${i}` }));
    }

    const recent = await store.getRecent(3);
    expect(recent).toHaveLength(3);
    expect(recent.map((r) => r.id)).toEqual(['insight-4', 'insight-3', 'insight-2']);
  });

  it('rejects invalid report data', async () => {
    const invalid = { id: '', snapshotId: '' } as unknown as InsightReport;
    await expect(store.save(invalid)).rejects.toThrow();
  });
});
