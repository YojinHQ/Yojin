import { describe, expect, it } from 'vitest';

import type { JintelClient, JintelResult } from '../../src/jintel/client.js';
import { createJintelPriceProvider } from '../../src/jintel/price-provider.js';
import type { MarketQuote } from '../../src/jintel/types.js';

function makeQuote(overrides: Partial<MarketQuote> = {}): MarketQuote {
  return {
    ticker: 'AAPL',
    price: 195.42,
    open: 193.0,
    high: 196.5,
    low: 192.8,
    previousClose: 193.5,
    change: 1.92,
    changePercent: 0.99,
    volume: 45_000_000,
    timestamp: '2025-01-15T16:00:00Z',
    source: 'test',
    ...overrides,
  };
}

function mockClient(result: JintelResult<MarketQuote[]>): JintelClient {
  return { quotes: async () => result } as unknown as JintelClient;
}

function makeProvider(result: JintelResult<MarketQuote[]>) {
  return createJintelPriceProvider({ getClient: () => mockClient(result) });
}

describe('createJintelPriceProvider', () => {
  const since = new Date('2025-01-10T00:00:00Z');

  it('returns PriceOutcome with correct fields', async () => {
    const provider = makeProvider({ success: true, data: [makeQuote()] });
    const outcome = await provider('AAPL', since);
    expect(outcome).toEqual({
      priceAtAnalysis: 193.5,
      priceNow: 195.42,
      returnPct: expect.closeTo(((195.42 - 193.5) / 193.5) * 100, 5),
      highInPeriod: 196.5,
      lowInPeriod: 192.8,
    });
  });

  it('uses previousClose for priceAtAnalysis', async () => {
    const provider = makeProvider({ success: true, data: [makeQuote({ previousClose: 190.0, open: 191.0 })] });
    const outcome = await provider('AAPL', since);
    expect(outcome.priceAtAnalysis).toBe(190.0);
  });

  it('falls back to open when previousClose is null', async () => {
    const provider = makeProvider({ success: true, data: [makeQuote({ previousClose: null, open: 191.0 })] });
    const outcome = await provider('AAPL', since);
    expect(outcome.priceAtAnalysis).toBe(191.0);
  });

  it('falls back to open when previousClose is undefined', async () => {
    const provider = makeProvider({ success: true, data: [makeQuote({ previousClose: undefined, open: 191.0 })] });
    const outcome = await provider('AAPL', since);
    expect(outcome.priceAtAnalysis).toBe(191.0);
  });

  it('falls back to price when both previousClose and open are null', async () => {
    const provider = makeProvider({ success: true, data: [makeQuote({ previousClose: null, open: null })] });
    const outcome = await provider('AAPL', since);
    expect(outcome.priceAtAnalysis).toBe(195.42);
  });

  it('computes returnPct correctly', async () => {
    const provider = makeProvider({ success: true, data: [makeQuote()] });
    const outcome = await provider('AAPL', since);
    const expected = ((195.42 - 193.5) / 193.5) * 100;
    expect(outcome.returnPct).toBeCloseTo(expected, 10);
  });

  it('uses quote.high and quote.low for period extremes', async () => {
    const provider = makeProvider({ success: true, data: [makeQuote({ high: 200.0, low: 185.0 })] });
    const outcome = await provider('AAPL', since);
    expect(outcome.highInPeriod).toBe(200.0);
    expect(outcome.lowInPeriod).toBe(185.0);
  });

  it('falls back high/low to priceNow when null', async () => {
    const provider = makeProvider({ success: true, data: [makeQuote({ high: null, low: null })] });
    const outcome = await provider('AAPL', since);
    expect(outcome.highInPeriod).toBe(195.42);
    expect(outcome.lowInPeriod).toBe(195.42);
  });

  it('throws when Jintel returns failure', async () => {
    const provider = makeProvider({ success: false, error: 'API unreachable' });
    await expect(provider('AAPL', since)).rejects.toThrow('Failed to fetch price for AAPL: API unreachable');
  });

  it('throws when ticker not found in quotes response', async () => {
    const provider = makeProvider({ success: true, data: [makeQuote({ ticker: 'MSFT' })] });
    await expect(provider('AAPL', since)).rejects.toThrow('No quote returned for ticker "AAPL"');
  });

  it('returns zero returnPct when priceAtAnalysis is zero', async () => {
    const provider = makeProvider({ success: true, data: [makeQuote({ previousClose: 0, open: 0, price: 10 })] });
    const outcome = await provider('AAPL', since);
    expect(outcome.returnPct).toBe(0);
  });

  it('throws when client is undefined', async () => {
    const provider = createJintelPriceProvider({ getClient: () => undefined });
    await expect(provider('AAPL', since)).rejects.toThrow('Jintel client not configured');
  });

  it('picks up client changes on subsequent calls', async () => {
    let client = mockClient({ success: true, data: [makeQuote({ price: 100, previousClose: 100 })] });
    const provider = createJintelPriceProvider({ getClient: () => client });

    const first = await provider('AAPL', since);
    expect(first.priceNow).toBe(100);

    // Swap client (simulates key rotation)
    client = mockClient({ success: true, data: [makeQuote({ price: 200, previousClose: 200 })] });
    const second = await provider('AAPL', since);
    expect(second.priceNow).toBe(200);
  });
});
