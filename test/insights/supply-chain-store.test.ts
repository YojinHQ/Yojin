import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SupplyChainStore } from '../../src/insights/supply-chain-store.js';
import type { SupplyChainMap } from '../../src/insights/supply-chain-types.js';

function makeMap(overrides?: Partial<SupplyChainMap>): SupplyChainMap {
  const asOf = overrides?.asOf ?? new Date().toISOString();
  const staleAfter = overrides?.staleAfter ?? new Date(Date.parse(asOf) + 86_400_000).toISOString();
  return {
    ticker: 'AAPL',
    entityName: 'Apple Inc.',
    upstream: [],
    downstream: [],
    geographicFootprint: [],
    concentrationRisks: [],
    narrative: null,
    asOf,
    dataAsOf: '2024-11-01',
    staleAfter,
    sources: [{ connector: 'sec-segments', asOf: '2024-11-01', ref: '0000320193-24-000123' }],
    synthesizedBy: null,
    ...overrides,
  };
}

describe('SupplyChainStore', () => {
  let dataRoot: string;
  let store: SupplyChainStore;

  beforeEach(() => {
    dataRoot = mkdtempSync(join(tmpdir(), 'supply-chain-store-'));
    store = new SupplyChainStore(dataRoot);
  });

  afterEach(() => {
    rmSync(dataRoot, { recursive: true, force: true });
  });

  it('round-trips put → get', async () => {
    const map = makeMap();
    await store.put(map);
    const got = await store.get('AAPL');
    expect(got).not.toBeNull();
    expect(got?.ticker).toBe('AAPL');
    expect(got?.entityName).toBe('Apple Inc.');
  });

  it('returns null on ENOENT', async () => {
    expect(await store.get('NOTHERE')).toBeNull();
  });

  it('isFresh returns false for missing file', async () => {
    expect(await store.isFresh('MISSING', 60_000)).toBe(false);
  });

  it('isFresh returns true for just-written map within window', async () => {
    await store.put(makeMap({ asOf: new Date().toISOString() }));
    expect(await store.isFresh('AAPL', 60_000)).toBe(true);
  });

  it('isFresh returns false when asOf is older than the window', async () => {
    const oldAsOf = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await store.put(makeMap({ asOf: oldAsOf }));
    expect(await store.isFresh('AAPL', 60 * 60 * 1000)).toBe(false);
  });

  it('getDataAsOf returns the stored value', async () => {
    await store.put(makeMap({ dataAsOf: '2024-11-01' }));
    expect(await store.getDataAsOf('AAPL')).toBe('2024-11-01');
  });

  it('is case-insensitive on ticker lookup', async () => {
    await store.put(makeMap({ ticker: 'aapl' }));
    const got = await store.get('aapl');
    expect(got?.ticker).toBe('aapl');
  });

  it('returns null on a schema-invalid stored file (no throw)', async () => {
    const { mkdir } = await import('node:fs/promises');
    const dir = join(dataRoot, 'supply-chain-maps');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'BAD.json'), JSON.stringify({ ticker: 'BAD' /* missing required fields */ }));
    const got = await store.get('BAD');
    expect(got).toBeNull();
  });

  it('returns null on a truncated tmp-file lookalike — reads only the final target', async () => {
    const { mkdir } = await import('node:fs/promises');
    const dir = join(dataRoot, 'supply-chain-maps');
    await mkdir(dir, { recursive: true });
    // Simulate a partially-written tmp file sitting next to the target — the
    // store must read AAPL.json, not the tmp file. The tmp file is ignored
    // because get() resolves to the canonical path.
    await writeFile(join(dir, `AAPL.json.${process.pid}.tmp`), '{"partial":');
    // No target file yet — get() returns null.
    const got = await store.get('AAPL');
    expect(got).toBeNull();
    // After put completes, the target is valid.
    await store.put(makeMap());
    const got2 = await store.get('AAPL');
    expect(got2?.ticker).toBe('AAPL');
  });
});
