import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadDataSourceConfigs } from '../../src/data-sources/config-loader.js';

describe('loadDataSourceConfigs', () => {
  it('loads flat JSON and converts to typed configs', async () => {
    const tmpPath = join(tmpdir(), `ds-test-${Date.now()}.json`);
    const flatConfigs = [
      {
        id: 'jintel',
        name: 'Jintel Intelligence',
        type: 'API',
        capabilities: ['enrichment', 'search'],
        enabled: true,
        priority: 1,
        builtin: true,
        baseUrl: 'https://api.jintel.ai/api',
        secretRef: 'jintel-api-key',
      },
      {
        id: 'curl-rss',
        name: 'RSS Feeds',
        type: 'CLI',
        capabilities: ['news'],
        enabled: true,
        priority: 10,
        command: 'curl',
        args: ['-s'],
      },
    ];
    await writeFile(tmpPath, JSON.stringify(flatConfigs));

    const configs = await loadDataSourceConfigs(tmpPath);

    expect(configs).toHaveLength(2);

    // API config
    const jintel = configs[0];
    expect(jintel.id).toBe('jintel');
    expect(jintel.builtin).toBe(true);
    expect(jintel.config.type).toBe('api');
    if (jintel.config.type === 'api') {
      expect(jintel.config.baseUrl).toBe('https://api.jintel.ai/api');
      expect(jintel.config.secretRef).toBe('jintel-api-key');
    }

    // CLI config
    const rss = configs[1];
    expect(rss.id).toBe('curl-rss');
    expect(rss.builtin).toBe(false);
    expect(rss.config.type).toBe('cli');
    if (rss.config.type === 'cli') {
      expect(rss.config.command).toBe('curl');
      expect(rss.config.args).toEqual(['-s']);
    }
  });

  it('defaults builtin to false when not specified', async () => {
    const tmpPath = join(tmpdir(), `ds-test-${Date.now()}.json`);
    await writeFile(
      tmpPath,
      JSON.stringify([
        {
          id: 'custom',
          name: 'Custom Source',
          type: 'API',
          capabilities: ['search'],
          enabled: true,
          priority: 5,
          baseUrl: 'https://custom.api.com',
        },
      ]),
    );

    const configs = await loadDataSourceConfigs(tmpPath);
    expect(configs[0].builtin).toBe(false);
  });
});
