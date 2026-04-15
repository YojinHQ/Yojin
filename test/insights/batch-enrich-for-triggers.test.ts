import type { Entity, JintelClient } from '@yojinhq/jintel-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { batchEnrichForTriggers } from '../../src/insights/data-gatherer.js';

function makeEntity(ticker: string, overrides: Partial<Entity> = {}): Entity {
  return {
    tickers: [ticker],
    market: { quote: { price: 100, changePercent: 0 } },
    ...overrides,
  } as Entity;
}

function makeClient(request: (query: string, variables: { tickers: string[] }) => Promise<Entity[]>): JintelClient {
  return { request: vi.fn(request) } as unknown as JintelClient;
}

describe('batchEnrichForTriggers', () => {
  let requestSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    requestSpy = vi.fn();
  });

  it('returns a map keyed by input ticker', async () => {
    const client = makeClient(async () => [makeEntity('AAPL'), makeEntity('MSFT')]);
    const result = await batchEnrichForTriggers(client, ['AAPL', 'MSFT']);
    expect(result.size).toBe(2);
    expect(result.get('AAPL')?.tickers).toContain('AAPL');
    expect(result.get('MSFT')?.tickers).toContain('MSFT');
  });

  it('matches case-insensitively between input and entity tickers', async () => {
    const client = makeClient(async () => [makeEntity('AAPL')]);
    const result = await batchEnrichForTriggers(client, ['aapl']);
    expect(result.get('aapl')?.tickers).toContain('AAPL');
  });

  it('uses the trigger-only enrich query (not the full bundle)', async () => {
    const client = makeClient(async () => [makeEntity('AAPL')]);
    await batchEnrichForTriggers(client, ['AAPL']);
    const query = (client.request as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(query).toMatch(/market/);
    expect(query).toMatch(/technicals/);
    expect(query).toMatch(/sentiment/);
    expect(query).not.toMatch(/\bnews\b/);
    expect(query).not.toMatch(/\bresearch\b/);
    expect(query).not.toMatch(/\brisk\b/);
    expect(query).not.toMatch(/\bregulatory\b/);
    expect(query).not.toMatch(/institutionalHoldings/);
    expect(query).not.toMatch(/topHolders/);
  });

  it('chunks requests at 20 tickers', async () => {
    const calls: string[][] = [];
    const client = makeClient(async (_q, { tickers }) => {
      calls.push([...tickers]);
      return tickers.map((t) => makeEntity(t));
    });
    const tickers = Array.from({ length: 45 }, (_, i) => `T${i}`);
    const result = await batchEnrichForTriggers(client, tickers);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toHaveLength(20);
    expect(calls[1]).toHaveLength(20);
    expect(calls[2]).toHaveLength(5);
    expect(result.size).toBe(45);
  });

  it('omits tickers without an entity but returns the rest', async () => {
    const client = makeClient(async () => [makeEntity('AAPL')]);
    const result = await batchEnrichForTriggers(client, ['AAPL', 'GONE']);
    expect(result.get('AAPL')).toBeTruthy();
    expect(result.has('GONE')).toBe(false);
  });

  it('swallows chunk failures and continues with other chunks', async () => {
    requestSpy = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw new Error('upstream 500');
      })
      .mockImplementationOnce(async (_q: string, { tickers }: { tickers: string[] }) =>
        tickers.map((t) => makeEntity(t)),
      );
    const client = { request: requestSpy } as unknown as JintelClient;
    const tickers = Array.from({ length: 25 }, (_, i) => `T${i}`);
    const result = await batchEnrichForTriggers(client, tickers);
    expect(result.size).toBe(5);
    expect(requestSpy).toHaveBeenCalledTimes(2);
  });
});
