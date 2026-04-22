import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Entity, JintelClient } from '@yojinhq/jintel-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureSupplyChainMap } from '../../src/insights/supply-chain-runner.js';
import { SupplyChainStore } from '../../src/insights/supply-chain-store.js';
import type { SupplyChainMap } from '../../src/insights/supply-chain-types.js';

function makeHop0Rich(): Entity {
  return {
    id: 'ent_aapl',
    type: 'COMPANY',
    name: 'Apple Inc.',
    tickers: ['AAPL'],
    subsidiaries: {
      accessionNumber: '0000320193-24-000123',
      form: '10-K',
      filingDate: '2024-11-01',
      filingUrl: 'https://example.com/filing',
      exhibitUrl: 'https://example.com/ex21',
      count: 1,
      subsidiaries: [{ name: 'Apple Ops Ireland', jurisdiction: 'Ireland' }],
    },
    concentration: {
      accessionNumber: '0000320193-24-000123',
      form: '10-K',
      filingDate: '2024-11-01',
      periodEnd: '2024-09-28',
      customer: {
        hhi: 3200,
        count: 3,
        total: 100,
        components: [
          { label: 'A', member: 'a', value: 50, share: 0.5 },
          { label: 'B', member: 'b', value: 30, share: 0.3 },
          { label: 'C', member: 'c', value: 20, share: 0.2 },
        ],
      },
    },
    relationships: [
      {
        type: 'CUSTOMER',
        direction: 'OUT',
        disclosure: 'DIRECT',
        confidence: 0.9,
        counterpartyName: 'Best Buy Co.',
        counterpartyTicker: 'BBY',
        counterpartyCik: '0000764478',
        sharePct: 0.08,
        valueUsd: 30_000_000_000,
        context: null,
        source: { connector: 'sec-segments', url: null, asOf: '2024-11-01', ref: 'ref-1' },
      },
    ],
  } as Entity;
}

function makeHop0Degraded(): Entity {
  return {
    id: 'ent_empty',
    type: 'COMPANY',
    name: 'Empty Co.',
    tickers: ['EMP'],
  } as Entity;
}

describe('ensureSupplyChainMap', () => {
  let dataRoot: string;
  let store: SupplyChainStore;

  beforeEach(() => {
    dataRoot = mkdtempSync(join(tmpdir(), 'supply-chain-runner-'));
    store = new SupplyChainStore(dataRoot);
  });

  afterEach(() => {
    rmSync(dataRoot, { recursive: true, force: true });
  });

  it('returns null when no Jintel client is provided', async () => {
    const out = await ensureSupplyChainMap({
      ticker: 'AAPL',
      store,
      maxAgeMs: 60_000,
    });
    expect(out).toBeNull();
  });

  it('cache hit — returns stored map and does not call Jintel', async () => {
    const now = new Date().toISOString();
    const cached: SupplyChainMap = {
      ticker: 'AAPL',
      entityName: 'Apple Inc.',
      upstream: [],
      downstream: [],
      geographicFootprint: [],
      concentrationRisks: [],
      narrative: null,
      asOf: now,
      dataAsOf: '2024-11-01',
      staleAfter: new Date(Date.parse(now) + 86_400_000).toISOString(),
      sources: [{ connector: 'sec-segments', asOf: '2024-11-01', ref: 'ref-1' }],
      synthesizedBy: null,
    };
    await store.put(cached);

    const batchEnrich = vi.fn();
    const client = { batchEnrich } as unknown as JintelClient;

    const out = await ensureSupplyChainMap({
      ticker: 'AAPL',
      jintelClient: client,
      store,
      maxAgeMs: 60 * 60 * 1000,
    });
    expect(out?.ticker).toBe('AAPL');
    expect(batchEnrich).not.toHaveBeenCalled();
  });

  it('cache miss — runs full pipeline (hop0, rank, hop1, build, put)', async () => {
    const hop0 = makeHop0Rich();
    const batchEnrich = vi
      .fn()
      // first call = hop0 (subsidiaries + concentration + relationships)
      .mockResolvedValueOnce({ success: true, data: [hop0] })
      // second call = hop1 over ranked counterparties
      .mockResolvedValueOnce({ success: true, data: [] });
    const client = { batchEnrich } as unknown as JintelClient;

    const out = await ensureSupplyChainMap({
      ticker: 'AAPL',
      jintelClient: client,
      store,
      maxAgeMs: 60_000,
    });
    expect(out).not.toBeNull();
    expect(out?.ticker).toBe('AAPL');
    expect(out?.downstream).toHaveLength(1);
    expect(batchEnrich).toHaveBeenCalledTimes(2);

    // Written through to the store.
    const stored = await store.get('AAPL');
    expect(stored?.ticker).toBe('AAPL');
  });

  it('degraded response (no edges / concentration / subsidiaries) serves stale, does not cache', async () => {
    const batchEnrich = vi.fn().mockResolvedValueOnce({ success: true, data: [makeHop0Degraded()] });
    const client = { batchEnrich } as unknown as JintelClient;

    const out = await ensureSupplyChainMap({
      ticker: 'EMP',
      jintelClient: client,
      store,
      maxAgeMs: 60_000,
    });
    // No prior cached value → stale fallback is null.
    expect(out).toBeNull();

    // Store was NOT written.
    expect(await store.exists('EMP')).toBe(false);
  });

  it('Jintel throws — falls back to stored map and does not rethrow', async () => {
    // Seed a prior map so the stale fallback has something to return.
    const now = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2h old
    const prior: SupplyChainMap = {
      ticker: 'AAPL',
      entityName: 'Apple Inc.',
      upstream: [],
      downstream: [],
      geographicFootprint: [],
      concentrationRisks: [],
      narrative: null,
      asOf: now,
      dataAsOf: '2024-10-01',
      staleAfter: new Date(Date.parse(now) + 86_400_000).toISOString(),
      sources: [],
      synthesizedBy: null,
    };
    await store.put(prior);

    const batchEnrich = vi.fn().mockRejectedValue(new Error('network down'));
    const client = { batchEnrich } as unknown as JintelClient;

    // Freshness window = 60s, so the 2h-old map is stale → full pipeline runs → throws → catch → stale fallback.
    const out = await ensureSupplyChainMap({
      ticker: 'AAPL',
      jintelClient: client,
      store,
      maxAgeMs: 60_000,
    });
    expect(out?.ticker).toBe('AAPL');
    expect(out?.dataAsOf).toBe('2024-10-01');
  });

  it('hop-0 returns no entity — serves stale fallback', async () => {
    const batchEnrich = vi.fn().mockResolvedValueOnce({ success: true, data: [] });
    const client = { batchEnrich } as unknown as JintelClient;

    const out = await ensureSupplyChainMap({
      ticker: 'NOPE',
      jintelClient: client,
      store,
      maxAgeMs: 60_000,
    });
    expect(out).toBeNull();
  });
});
