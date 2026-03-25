import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SignalGroupArchive } from '../../src/signals/group-archive.js';
import { SignalGroupSchema } from '../../src/signals/group-types.js';
import type { SignalGroup } from '../../src/signals/group-types.js';

function makeGroup(overrides: Partial<SignalGroup> = {}): SignalGroup {
  return {
    id: 'grp-001',
    signalIds: ['sig-001', 'sig-002'],
    tickers: ['AAPL'],
    summary: 'Earnings beat followed by analyst upgrades.',
    outputType: 'INSIGHT',
    firstEventAt: '2026-03-21T09:00:00.000Z',
    lastEventAt: '2026-03-21T11:00:00.000Z',
    version: 1,
    createdAt: '2026-03-21T11:00:00.000Z',
    updatedAt: '2026-03-21T11:00:00.000Z',
    ...overrides,
  };
}

describe('SignalGroupSchema', () => {
  it('accepts a valid group', () => {
    const result = SignalGroupSchema.safeParse(makeGroup());
    expect(result.success).toBe(true);
  });

  it('rejects empty signalIds array', () => {
    const result = SignalGroupSchema.safeParse(makeGroup({ signalIds: [] }));
    expect(result.success).toBe(false);
  });

  it('rejects single signalId (min 2 required)', () => {
    const result = SignalGroupSchema.safeParse(makeGroup({ signalIds: ['sig-001'] }));
    expect(result.success).toBe(false);
  });

  it('rejects empty id', () => {
    const result = SignalGroupSchema.safeParse(makeGroup({ id: '' }));
    expect(result.success).toBe(false);
  });

  it('rejects empty summary', () => {
    const result = SignalGroupSchema.safeParse(makeGroup({ summary: '' }));
    expect(result.success).toBe(false);
  });

  it('defaults outputType to INSIGHT when omitted', () => {
    const raw = makeGroup() as Record<string, unknown>;
    delete raw['outputType'];
    const result = SignalGroupSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.outputType).toBe('INSIGHT');
  });

  it('defaults version to 1 when omitted', () => {
    const raw = makeGroup() as Record<string, unknown>;
    delete raw['version'];
    const result = SignalGroupSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.version).toBe(1);
  });
});

describe('SignalGroupArchive', () => {
  let dir: string;
  let archive: SignalGroupArchive;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'yojin-groups-'));
    archive = new SignalGroupArchive({ dir });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('appends and retrieves by ID', async () => {
    await archive.append(makeGroup({ id: 'grp-001' }));
    const found = await archive.getById('grp-001');
    expect(found).not.toBeNull();
    expect(found?.id).toBe('grp-001');
  });

  it('returns null for unknown ID', async () => {
    const found = await archive.getById('does-not-exist');
    expect(found).toBeNull();
  });

  it('returns empty results for empty archive', async () => {
    expect(await archive.query({})).toHaveLength(0);
    expect(await archive.listDates()).toHaveLength(0);
  });

  it('version dedup — getById returns highest version', async () => {
    const v1 = makeGroup({ id: 'grp-v', version: 1, summary: 'Version one.' });
    const v2 = makeGroup({ id: 'grp-v', version: 2, summary: 'Version two.' });
    await archive.append(v1);
    await archive.appendUpdate(v2);

    const found = await archive.getById('grp-v');
    expect(found?.version).toBe(2);
    expect(found?.summary).toBe('Version two.');
  });

  it('version dedup — query returns only highest version per group', async () => {
    await archive.appendBatch([
      makeGroup({ id: 'grp-a', version: 1, summary: 'A v1.' }),
      makeGroup({ id: 'grp-a', version: 3, summary: 'A v3.' }),
      makeGroup({ id: 'grp-a', version: 2, summary: 'A v2.' }),
    ]);
    const results = await archive.query({});
    const a = results.filter((g) => g.id === 'grp-a');
    expect(a).toHaveLength(1);
    expect(a[0].version).toBe(3);
  });

  it('appendBatch writes multiple groups', async () => {
    await archive.appendBatch([
      makeGroup({ id: 'g1', tickers: ['AAPL'] }),
      makeGroup({ id: 'g2', tickers: ['TSLA'] }),
      makeGroup({ id: 'g3', tickers: ['MSFT'] }),
    ]);
    const results = await archive.query({});
    expect(results).toHaveLength(3);
  });

  it('handles empty batch gracefully', async () => {
    await archive.appendBatch([]);
    expect(await archive.query({})).toHaveLength(0);
  });

  it('query filters by single ticker', async () => {
    await archive.appendBatch([
      makeGroup({ id: 'g1', tickers: ['AAPL', 'MSFT'] }),
      makeGroup({ id: 'g2', tickers: ['TSLA'] }),
    ]);
    const results = await archive.query({ ticker: 'AAPL' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('g1');
  });

  it('query filters by tickers array (matches any)', async () => {
    await archive.appendBatch([
      makeGroup({ id: 'g1', tickers: ['AAPL'] }),
      makeGroup({ id: 'g2', tickers: ['TSLA'] }),
      makeGroup({ id: 'g3', tickers: ['MSFT'] }),
      makeGroup({ id: 'g4', tickers: ['GOOG'] }),
    ]);
    const results = await archive.query({ tickers: ['AAPL', 'MSFT'] });
    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.id).sort();
    expect(ids).toEqual(['g1', 'g3']);
  });

  it('tickers filter takes precedence over single ticker', async () => {
    await archive.appendBatch([makeGroup({ id: 'g1', tickers: ['AAPL'] }), makeGroup({ id: 'g2', tickers: ['TSLA'] })]);
    // tickers should take precedence — ticker='AAPL' is ignored
    const results = await archive.query({ ticker: 'AAPL', tickers: ['TSLA'] });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('g2');
  });

  it('query respects limit parameter', async () => {
    await archive.appendBatch([makeGroup({ id: 'g1' }), makeGroup({ id: 'g2' }), makeGroup({ id: 'g3' })]);
    const results = await archive.query({ limit: 2 });
    expect(results).toHaveLength(2);
  });

  it('getByTickers returns matching groups within the time window', async () => {
    const now = new Date();
    const recentAt = now.toISOString();
    const oldAt = new Date(now.getTime() - 200 * 60 * 60 * 1000).toISOString(); // 200h ago — outside 168h window

    await archive.appendBatch([
      makeGroup({
        id: 'recent-aapl',
        tickers: ['AAPL'],
        lastEventAt: recentAt,
        createdAt: recentAt,
        updatedAt: recentAt,
        firstEventAt: recentAt,
      }),
      makeGroup({
        id: 'old-aapl',
        tickers: ['AAPL'],
        lastEventAt: oldAt,
        createdAt: new Date(now.getTime() - 201 * 60 * 60 * 1000).toISOString(),
        updatedAt: oldAt,
        firstEventAt: oldAt,
      }),
      makeGroup({
        id: 'recent-tsla',
        tickers: ['TSLA'],
        lastEventAt: recentAt,
        createdAt: recentAt,
        updatedAt: recentAt,
        firstEventAt: recentAt,
      }),
    ]);

    const results = await archive.getByTickers(['AAPL']);
    const ids = results.map((g) => g.id);
    expect(ids).toContain('recent-aapl');
    expect(ids).not.toContain('old-aapl');
    expect(ids).not.toContain('recent-tsla');
  });

  it('getByTickers returns groups where any ticker overlaps', async () => {
    const now = new Date().toISOString();
    await archive.appendBatch([
      makeGroup({
        id: 'g1',
        tickers: ['AAPL', 'MSFT'],
        lastEventAt: now,
        createdAt: now,
        updatedAt: now,
        firstEventAt: now,
      }),
      makeGroup({ id: 'g2', tickers: ['TSLA'], lastEventAt: now, createdAt: now, updatedAt: now, firstEventAt: now }),
    ]);

    const results = await archive.getByTickers(['MSFT', 'TSLA']);
    const ids = results.map((g) => g.id).sort();
    expect(ids).toEqual(['g1', 'g2']);
  });

  it('getByTickers returns empty array for empty tickers input', async () => {
    await archive.append(makeGroup());
    const results = await archive.getByTickers([]);
    expect(results).toHaveLength(0);
  });

  it('partitions groups by createdAt date', async () => {
    await archive.appendBatch([
      makeGroup({ id: 'g1', createdAt: '2026-03-20T10:00:00.000Z', updatedAt: '2026-03-20T10:00:00.000Z' }),
      makeGroup({ id: 'g2', createdAt: '2026-03-21T10:00:00.000Z', updatedAt: '2026-03-21T10:00:00.000Z' }),
    ]);
    const dates = await archive.listDates();
    expect(dates).toEqual(['2026-03-20', '2026-03-21']);
  });
});
