import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StrategySourceStore } from '../../src/skills/strategy-source-store.js';
import { DEFAULT_SOURCE_ID } from '../../src/skills/strategy-source-types.js';

let tempDir = '';
let configPath = '';

beforeEach(() => {
  tempDir = join(tmpdir(), `strategy-source-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tempDir, { recursive: true });
  configPath = join(tempDir, 'strategy-sources.json');
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('StrategySourceStore', () => {
  it('seeds default source on first initialize', async () => {
    const store = new StrategySourceStore(configPath);
    await store.initialize();

    const all = store.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(DEFAULT_SOURCE_ID);
    expect(all[0].label).toBe('Yojin Official');
    expect(existsSync(configPath)).toBe(true);
  });

  it('loads existing sources from disk', async () => {
    const store1 = new StrategySourceStore(configPath);
    await store1.initialize();
    store1.add({ owner: 'acme', repo: 'strats', path: '', ref: 'main', enabled: true });

    const store2 = new StrategySourceStore(configPath);
    await store2.initialize();

    expect(store2.getAll()).toHaveLength(2);
    expect(store2.getById('acme/strats')).toBeDefined();
    expect(store2.getById(DEFAULT_SOURCE_ID)).toBeDefined();
  });

  it('adds a source and persists to disk', async () => {
    const store = new StrategySourceStore(configPath);
    await store.initialize();

    const added = store.add({ owner: 'foo', repo: 'bar', path: 'strategies', ref: 'develop', enabled: true });
    expect(added.id).toBe('foo/bar');
    expect(added.ref).toBe('develop');

    const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(raw).toHaveLength(2);
    expect(raw.find((s: { id: string }) => s.id === 'foo/bar')).toBeDefined();
  });

  it('throws on duplicate source', async () => {
    const store = new StrategySourceStore(configPath);
    await store.initialize();
    store.add({ owner: 'dup', repo: 'test', path: '', ref: 'main', enabled: true });

    expect(() => store.add({ owner: 'dup', repo: 'test', path: '', ref: 'main', enabled: true })).toThrow(
      'Strategy source already exists: dup/test',
    );
  });

  it('removes a non-default source', async () => {
    const store = new StrategySourceStore(configPath);
    await store.initialize();
    store.add({ owner: 'removable', repo: 'repo', path: '', ref: 'main', enabled: true });

    store.remove('removable/repo');
    expect(store.getAll()).toHaveLength(1);
    expect(store.getById('removable/repo')).toBeUndefined();
  });

  it('prevents removing the default source', async () => {
    const store = new StrategySourceStore(configPath);
    await store.initialize();

    expect(() => store.remove(DEFAULT_SOURCE_ID)).toThrow(
      'Cannot remove the default strategy source. Disable it instead.',
    );
  });

  it('toggles enabled state', async () => {
    const store = new StrategySourceStore(configPath);
    await store.initialize();

    const disabled = store.setEnabled(DEFAULT_SOURCE_ID, false);
    expect(disabled.enabled).toBe(false);

    const enabled = store.setEnabled(DEFAULT_SOURCE_ID, true);
    expect(enabled.enabled).toBe(true);
  });

  it('getEnabled filters disabled sources', async () => {
    const store = new StrategySourceStore(configPath);
    await store.initialize();
    store.add({ owner: 'extra', repo: 'repo', path: '', ref: 'main', enabled: true });
    store.setEnabled(DEFAULT_SOURCE_ID, false);

    const enabled = store.getEnabled();
    expect(enabled).toHaveLength(1);
    expect(enabled[0].id).toBe('extra/repo');
  });

  it('updates lastSyncedAt', async () => {
    const store = new StrategySourceStore(configPath);
    await store.initialize();

    expect(store.getById(DEFAULT_SOURCE_ID)?.lastSyncedAt).toBeUndefined();

    const before = new Date().toISOString();
    const updated = store.updateLastSynced(DEFAULT_SOURCE_ID);
    const after = new Date().toISOString();

    expect(updated.lastSyncedAt).toBeDefined();
    expect(updated.lastSyncedAt! >= before).toBe(true);
    expect(updated.lastSyncedAt! <= after).toBe(true);
  });
});
