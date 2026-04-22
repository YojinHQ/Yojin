import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Entity } from '@yojinhq/jintel-client';
import { describe, expect, it } from 'vitest';

import { buildRawSupplyChainMap, deriveConcentrationRisks } from '../../src/insights/supply-chain-raw-builder.js';
import { SupplyChainMapSchema } from '../../src/insights/supply-chain-types.js';

const dirName = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(dirName, '../fixtures/supply-chain/aapl-hop0.json');

async function loadAaplHop0(): Promise<Entity> {
  const raw = await readFile(FIXTURE_PATH, 'utf-8');
  return JSON.parse(raw) as Entity;
}

describe('buildRawSupplyChainMap', () => {
  it('splits relationships into upstream and downstream by direction + type', async () => {
    const hop0 = await loadAaplHop0();
    const map = buildRawSupplyChainMap('AAPL', hop0, []);

    // PARTNER IN (TSM) + SUBSIDIARY OUT (Apple Ops Ireland) → upstream.
    expect(map.upstream).toHaveLength(2);
    const upstreamNames = map.upstream.map((e) => e.counterpartyName).sort();
    expect(upstreamNames).toEqual(
      ['Apple Operations International Limited', 'Taiwan Semiconductor Manufacturing Co.'].sort(),
    );

    // CUSTOMER OUT (BBY) → downstream.
    expect(map.downstream).toHaveLength(1);
    expect(map.downstream[0]?.counterpartyName).toBe('Best Buy Co.');
    expect(map.downstream[0]?.counterpartyTicker).toBe('BBY');
    expect(map.downstream[0]?.sharePct).toBe(0.08);
    expect(map.downstream[0]?.valueUsd).toBe(30_000_000_000);
  });

  it('tags every edge as JINTEL_DIRECT with null substitutability in Phase A', async () => {
    const hop0 = await loadAaplHop0();
    const map = buildRawSupplyChainMap('AAPL', hop0, []);
    for (const edge of map.upstream) {
      expect(edge.edgeOrigin).toBe('JINTEL_DIRECT');
      expect(edge.substitutability).toBeNull();
    }
    for (const edge of map.downstream) {
      expect(edge.edgeOrigin).toBe('JINTEL_DIRECT');
    }
  });

  it('copies evidence verbatim from the Jintel edge source', async () => {
    const hop0 = await loadAaplHop0();
    const map = buildRawSupplyChainMap('AAPL', hop0, []);

    const bby = map.downstream.find((e) => e.counterpartyTicker === 'BBY');
    expect(bby).toBeDefined();
    expect(bby?.evidence).toHaveLength(1);
    expect(bby?.evidence[0]).toEqual({
      connector: 'sec-segments',
      url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/',
      ref: '0000320193-24-000123',
      asOf: '2024-11-01',
      contextQuote: 'Revenue from wholesale channel disclosed in FY24 10-K',
    });

    const subsidiary = map.upstream.find((e) => e.counterpartyName === 'Apple Operations International Limited');
    expect(subsidiary?.evidence[0]?.connector).toBe('sec-exhibit21');
    expect(subsidiary?.evidence[0]?.ref).toBe('0000320193-24-000123');
  });

  it('assigns upstream criticality in [0,1] with single-edge fallback 0.5', async () => {
    const hop0 = await loadAaplHop0();
    const map = buildRawSupplyChainMap('AAPL', hop0, []);
    for (const edge of map.upstream) {
      expect(edge.criticality).toBeGreaterThanOrEqual(0);
      expect(edge.criticality).toBeLessThanOrEqual(1);
    }
  });

  it('surfaces the CUSTOMER concentration flag for HHI>=2500 or top-3 share>=0.6', async () => {
    const hop0 = await loadAaplHop0();
    const map = buildRawSupplyChainMap('AAPL', hop0, []);
    // Fixture: HHI=3200 (>=2500) and top-3 share = 1.0 (>=0.6).
    const customerFlag = map.concentrationRisks.find((f) => f.dimension === 'CUSTOMER');
    expect(customerFlag).toBeDefined();
    expect(customerFlag?.hhi).toBe(3200);
    expect(customerFlag?.label).toContain('customer');
  });

  it('rolls up geographic footprint from subsidiaries, normalizing jurisdictions', async () => {
    const hop0 = await loadAaplHop0();
    const map = buildRawSupplyChainMap('AAPL', hop0, []);
    // Ireland → IE; California → US.
    const iso2s = map.geographicFootprint.map((e) => e.iso2).sort();
    expect(iso2s).toEqual(['IE', 'US']);
  });

  it('sets dataAsOf to the max source.asOf across used edges', async () => {
    const hop0 = await loadAaplHop0();
    const map = buildRawSupplyChainMap('AAPL', hop0, []);
    expect(map.dataAsOf).toBe('2024-11-01');
  });

  it('narrative and synthesizedBy are null in Phase A', async () => {
    const hop0 = await loadAaplHop0();
    const map = buildRawSupplyChainMap('AAPL', hop0, []);
    expect(map.narrative).toBeNull();
    expect(map.synthesizedBy).toBeNull();
  });

  it('dedupes sources by (connector, ref)', async () => {
    const hop0 = await loadAaplHop0();
    const map = buildRawSupplyChainMap('AAPL', hop0, []);
    const keys = map.sources.map((s) => `${s.connector}|${s.ref ?? ''}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('sets staleAfter to asOf + 24h', async () => {
    const hop0 = await loadAaplHop0();
    const map = buildRawSupplyChainMap('AAPL', hop0, []);
    const delta = Date.parse(map.staleAfter) - Date.parse(map.asOf);
    expect(delta).toBe(24 * 60 * 60 * 1000);
  });

  it('schema-parses the built map', async () => {
    const hop0 = await loadAaplHop0();
    const map = buildRawSupplyChainMap('AAPL', hop0, []);
    // buildRawSupplyChainMap already calls `.parse()` internally; re-running
    // here confirms the output type shape for consumers.
    expect(() => SupplyChainMapSchema.parse(map)).not.toThrow();
  });

  it('returns empty arrays when the entity has no relationships / subsidiaries / concentration', () => {
    const empty: Entity = {
      id: 'ent_empty',
      type: 'COMPANY',
      name: 'Empty Co.',
      tickers: ['EMP'],
    } as Entity;
    const map = buildRawSupplyChainMap('EMP', empty, []);
    expect(map.upstream).toEqual([]);
    expect(map.downstream).toEqual([]);
    expect(map.geographicFootprint).toEqual([]);
    expect(map.concentrationRisks).toEqual([]);
    expect(map.dataAsOf).toBeNull();
    expect(map.sources).toEqual([]);
  });

  it('keys the map by the requested ticker, ignoring hop0.id and hop0.tickers[0]', () => {
    const entity: Entity = {
      id: 'ent_internal_xyz',
      type: 'COMPANY',
      name: 'Mismatch Inc.',
      tickers: ['WRONG'],
    } as Entity;
    const map = buildRawSupplyChainMap('right', entity, []);
    expect(map.ticker).toBe('RIGHT');
  });

  it('keys the map by the requested ticker even when hop0.tickers is absent', () => {
    const entity: Entity = {
      id: 'ent_internal_xyz',
      type: 'COMPANY',
      name: 'No Ticker Co.',
    } as Entity;
    const map = buildRawSupplyChainMap('ARM', entity, []);
    expect(map.ticker).toBe('ARM');
  });
});

describe('deriveConcentrationRisks', () => {
  it('fires CUSTOMER flag when HHI >= 2500', () => {
    const flags = deriveConcentrationRisks({
      customer: {
        hhi: 2600,
        count: 3,
        total: 100,
        components: [
          { label: 'A', member: 'a', value: 40, share: 0.4 },
          { label: 'B', member: 'b', value: 30, share: 0.3 },
          { label: 'C', member: 'c', value: 30, share: 0.3 },
        ],
      },
    } as Entity['concentration']);
    expect(flags).toHaveLength(1);
    expect(flags[0]?.dimension).toBe('CUSTOMER');
  });

  it('fires SEGMENT flag when top-3 share >= 0.6 even if HHI < 2500', () => {
    const flags = deriveConcentrationRisks({
      segment: {
        hhi: 1800,
        count: 5,
        total: 100,
        components: [
          { label: 'S1', member: 's1', value: 30, share: 0.3 },
          { label: 'S2', member: 's2', value: 20, share: 0.2 },
          { label: 'S3', member: 's3', value: 15, share: 0.15 },
          { label: 'S4', member: 's4', value: 20, share: 0.2 },
          { label: 'S5', member: 's5', value: 15, share: 0.15 },
        ],
      },
    } as Entity['concentration']);
    // Top-3 = 0.3 + 0.2 + 0.2 = 0.7 (after sort) → fires.
    expect(flags.find((f) => f.dimension === 'SEGMENT')).toBeDefined();
  });

  it('skips dimensions with null HHI', () => {
    const flags = deriveConcentrationRisks({
      geography: {
        hhi: null,
        count: 2,
        total: 100,
        components: [
          { label: 'X', member: 'x', value: 80, share: 0.8 },
          { label: 'Y', member: 'y', value: 20, share: 0.2 },
        ],
      },
    } as Entity['concentration']);
    expect(flags.find((f) => f.dimension === 'GEOGRAPHY')).toBeUndefined();
  });

  it('returns empty array when concentration is null', () => {
    expect(deriveConcentrationRisks(null)).toEqual([]);
  });
});
