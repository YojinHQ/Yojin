import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  AIProviderConfigSchema,
  AlertsConfigSchema,
  GuardConfigSchema,
  OpenBBConfigSchema,
  loadJsonConfig,
} from '../../src/config/config.js';

describe('loadJsonConfig', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `yojin-test-config-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('loads and validates a JSON config file', async () => {
    const schema = z.object({ name: z.string(), count: z.number().default(0) });
    const filePath = join(testDir, 'test.json');
    await writeFile(filePath, JSON.stringify({ name: 'hello' }));

    const config = await loadJsonConfig(filePath, schema);
    expect(config.name).toBe('hello');
    expect(config.count).toBe(0);
  });

  it('returns defaults when file does not exist', async () => {
    const schema = z.object({
      name: z.string().default('fallback'),
      count: z.number().default(5),
    });
    const filePath = join(testDir, 'missing.json');

    const config = await loadJsonConfig(filePath, schema);
    expect(config.name).toBe('fallback');
    expect(config.count).toBe(5);
  });

  it('throws on invalid config', async () => {
    const schema = z.object({ name: z.string(), count: z.number() });
    const filePath = join(testDir, 'bad.json');
    await writeFile(filePath, JSON.stringify({ name: 123 }));

    await expect(loadJsonConfig(filePath, schema)).rejects.toThrow();
  });

  it('reads fresh on every call (hot-reload)', async () => {
    const schema = z.object({ value: z.string() });
    const filePath = join(testDir, 'hot.json');

    await writeFile(filePath, JSON.stringify({ value: 'first' }));
    const config1 = await loadJsonConfig(filePath, schema);
    expect(config1.value).toBe('first');

    await writeFile(filePath, JSON.stringify({ value: 'second' }));
    const config2 = await loadJsonConfig(filePath, schema);
    expect(config2.value).toBe('second');
  });
});

describe('Config schemas have sensible defaults', () => {
  it('AlertsConfigSchema', () => {
    const config = AlertsConfigSchema.parse({});
    expect(config).toBeDefined();
    expect(config.rules).toEqual([]);
  });

  it('OpenBBConfigSchema', () => {
    const config = OpenBBConfigSchema.parse({});
    expect(config).toBeDefined();
    expect(config.providers).toEqual({});
  });

  it('AIProviderConfigSchema', () => {
    const config = AIProviderConfigSchema.parse({});
    expect(config).toBeDefined();
    expect(config.defaultProvider).toBe('anthropic');
  });

  it('GuardConfigSchema', () => {
    const config = GuardConfigSchema.parse({});
    expect(config).toBeDefined();
    expect(config.posture).toBe('local');
  });
});
