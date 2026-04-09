import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchStrategiesFromSource } from '../../src/skills/strategy-source-fetcher.js';
import type { StrategySource } from '../../src/skills/strategy-source-types.js';

const mockSource: StrategySource = {
  id: 'test/repo',
  owner: 'test',
  repo: 'repo',
  path: 'strategies',
  ref: 'main',
  enabled: true,
};

const mockDirListing = [
  {
    name: 'price-momentum.md',
    type: 'file',
    download_url: 'https://raw.githubusercontent.com/test/repo/main/strategies/price-momentum.md',
  },
  { name: 'README.md', type: 'file', download_url: null },
  { name: 'subfolder', type: 'dir', download_url: null },
  {
    name: 'bollinger.md',
    type: 'file',
    download_url: 'https://raw.githubusercontent.com/test/repo/main/strategies/bollinger.md',
  },
];

const mockStrategyContent = `---
name: Price Momentum
description: Test strategy
category: MARKET
style: momentum
requires: [market_data]
triggers:
  - type: PRICE_MOVE
    description: Test
    params:
      threshold: 0.15
tickers: []
---

## Thesis
Test content.
`;

describe('fetchStrategiesFromSource', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches directory listing and then each .md file', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(mockDirListing), { status: 200 }))
      .mockResolvedValueOnce(new Response(mockStrategyContent, { status: 200 }))
      .mockResolvedValueOnce(new Response(mockStrategyContent, { status: 200 }));

    const result = await fetchStrategiesFromSource(mockSource);
    expect(result.strategies).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // First call: directory listing
    expect(fetchMock.mock.calls[0][0]).toContain('api.github.com/repos/test/repo/contents/strategies');
  });

  it('skips README.md and non-file entries', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(mockDirListing), { status: 200 }))
      .mockResolvedValueOnce(new Response(mockStrategyContent, { status: 200 }))
      .mockResolvedValueOnce(new Response(mockStrategyContent, { status: 200 }));

    const result = await fetchStrategiesFromSource(mockSource);
    const filenames = result.strategies.map((s) => s.filename);
    expect(filenames).not.toContain('README.md');
    expect(filenames).toContain('price-momentum.md');
    expect(filenames).toContain('bollinger.md');
  });

  it('reports errors for failed directory listing', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

    const result = await fetchStrategiesFromSource(mockSource);
    expect(result.strategies).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('test/repo');
  });

  it('reports errors for individual file fetch failures', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(mockDirListing), { status: 200 }))
      .mockResolvedValueOnce(new Response('Server Error', { status: 500 }))
      .mockResolvedValueOnce(new Response(mockStrategyContent, { status: 200 }));

    const result = await fetchStrategiesFromSource(mockSource);
    expect(result.strategies).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });

  it('handles source with empty path', async () => {
    const rootSource = { ...mockSource, path: '' };
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    await fetchStrategiesFromSource(rootSource);
    expect(fetchMock.mock.calls[0][0]).toContain('api.github.com/repos/test/repo/contents?ref=main');
  });
});
