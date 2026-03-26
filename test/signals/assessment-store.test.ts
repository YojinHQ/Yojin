import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AssessmentStore } from '../../src/signals/curation/assessment-store.js';
import type { AssessmentReport } from '../../src/signals/curation/assessment-types.js';

function makeReport(overrides: Partial<AssessmentReport> = {}): AssessmentReport {
  return {
    id: 'assess-001',
    assessedAt: '2026-03-21T14:00:00.000Z',
    tickers: ['AAPL', 'MSFT'],
    assessments: [
      {
        signalId: 'sig-001',
        ticker: 'AAPL',
        verdict: 'CRITICAL',
        relevanceScore: 0.92,
        reasoning: 'Directly impacts core revenue thesis',
        thesisAlignment: 'SUPPORTS',
        actionability: 0.85,
      },
      {
        signalId: 'sig-002',
        ticker: 'MSFT',
        verdict: 'IMPORTANT',
        relevanceScore: 0.7,
        reasoning: 'Cloud growth signal consistent with sector trend',
        thesisAlignment: 'NEUTRAL',
        actionability: 0.6,
      },
    ],
    signalsInput: 10,
    signalsKept: 2,
    thesisSummary: 'Bullish on big tech AI narrative',
    durationMs: 5000,
    ...overrides,
  };
}

describe('AssessmentStore', () => {
  let dataRoot: string;
  let store: AssessmentStore;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'yojin-assess-'));
    store = new AssessmentStore(dataRoot);
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('saves and retrieves a report', async () => {
    const report = makeReport();
    await store.save(report);

    const latest = await store.getLatest();
    expect(latest).not.toBeNull();
    expect(latest!.id).toBe('assess-001');
    expect(latest!.assessments).toHaveLength(2);
  });

  it('returns null when no reports exist', async () => {
    const latest = await store.getLatest();
    expect(latest).toBeNull();
  });

  it('queries by tickers', async () => {
    await store.save(makeReport({ id: 'r1', tickers: ['AAPL'] }));
    await store.save(makeReport({ id: 'r2', tickers: ['TSLA'] }));

    const results = await store.queryByTickers(['AAPL']);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('r1');
  });

  it('filters by since date', async () => {
    await store.save(makeReport({ id: 'r1', assessedAt: '2026-03-20T10:00:00.000Z' }));
    await store.save(makeReport({ id: 'r2', assessedAt: '2026-03-21T10:00:00.000Z' }));

    const results = await store.queryByTickers(['AAPL', 'MSFT'], { since: '2026-03-21' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('r2');
  });

  it('respects limit', async () => {
    await store.save(makeReport({ id: 'r1' }));
    await store.save(makeReport({ id: 'r2' }));
    await store.save(makeReport({ id: 'r3' }));

    const results = await store.queryByTickers(['AAPL', 'MSFT'], { limit: 2 });
    expect(results).toHaveLength(2);
  });

  it('handles watermark round-trip', async () => {
    expect(await store.getLatestWatermark()).toBeNull();

    const watermark = {
      lastRunAt: '2026-03-21T14:00:00.000Z',
      lastCuratedAt: '2026-03-21T13:45:00.000Z',
      signalsAssessed: 20,
      signalsKept: 5,
    };
    await store.saveWatermark(watermark);

    const loaded = await store.getLatestWatermark();
    expect(loaded).not.toBeNull();
    expect(loaded!.signalsAssessed).toBe(20);
    expect(loaded!.signalsKept).toBe(5);
    expect(loaded!.lastCuratedAt).toBe('2026-03-21T13:45:00.000Z');
  });

  it('returns latest report across multiple dates', async () => {
    await store.save(makeReport({ id: 'old', assessedAt: '2026-03-20T10:00:00.000Z' }));
    await store.save(makeReport({ id: 'new', assessedAt: '2026-03-21T10:00:00.000Z' }));

    const latest = await store.getLatest();
    expect(latest!.id).toBe('new');
  });
});
