import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('resolveDataRoot', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns $YOJIN_HOME when set', async () => {
    process.env.YOJIN_HOME = '/custom/yojin';
    const { resolveDataRoot } = await import('../src/paths.js');
    expect(resolveDataRoot()).toBe('/custom/yojin');
  });

  it('returns ~/.yojin when $YOJIN_HOME is not set', async () => {
    delete process.env.YOJIN_HOME;
    const { resolveDataRoot } = await import('../src/paths.js');
    expect(resolveDataRoot()).toBe(join(homedir(), '.yojin'));
  });

  it('strips trailing slash from $YOJIN_HOME', async () => {
    process.env.YOJIN_HOME = '/custom/yojin/';
    const { resolveDataRoot } = await import('../src/paths.js');
    expect(resolveDataRoot()).toBe('/custom/yojin');
  });
});

describe('resolveDefaultsRoot', () => {
  it('returns a path containing data/default', async () => {
    const { resolveDefaultsRoot } = await import('../src/paths.js');
    const result = resolveDefaultsRoot();
    expect(result).toContain(['data', 'default'].join(sep));
  });

  it('returns a path where persona.default.md exists', async () => {
    const { resolveDefaultsRoot } = await import('../src/paths.js');
    const personaPath = join(resolveDefaultsRoot(), 'persona.default.md');
    expect(existsSync(personaPath)).toBe(true);
  });
});

describe('ensureDataDirs', () => {
  const testRoot = join(tmpdir(), `yojin-test-${Date.now()}`);

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
  });

  it('creates all expected subdirectories', async () => {
    const { ensureDataDirs } = await import('../src/paths.js');
    await ensureDataDirs(testRoot);

    const expected = [
      'config',
      'vault',
      'brain',
      'sessions',
      'snapshots',
      'audit',
      'event-log',
      'cache',
      'news-archive',
      'cron',
      'acp',
    ];

    for (const dir of expected) {
      expect(existsSync(join(testRoot, dir))).toBe(true);
    }
  });

  it('is idempotent — calling twice does not throw', async () => {
    const { ensureDataDirs } = await import('../src/paths.js');
    await ensureDataDirs(testRoot);
    await expect(ensureDataDirs(testRoot)).resolves.not.toThrow();
  });
});
