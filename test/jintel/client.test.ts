import { EntitySchema, JintelClient, MarketQuoteSchema } from '@yojinhq/jintel-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
});
afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeClient(overrides?: Partial<{ baseUrl: string; apiKey: string }>): JintelClient {
  return new JintelClient({
    baseUrl: overrides?.baseUrl ?? 'http://localhost:4000/api',
    apiKey: overrides?.apiKey ?? 'test-key-0123456789abcdef',
  });
}

describe('Jintel Zod schemas', () => {
  it('validates a MarketQuote', () => {
    const quote = {
      ticker: 'AAPL',
      price: 195.42,
      open: 193.0,
      high: 196.5,
      low: 192.8,
      previousClose: 193.5,
      change: 1.92,
      changePercent: 0.99,
      volume: 45_000_000,
      marketCap: 3e12,
      timestamp: '2026-03-23T16:00:00Z',
      source: 'Alpha Vantage',
    };
    const parsed = MarketQuoteSchema.parse(quote);
    expect(parsed.ticker).toBe('AAPL');
    expect(parsed.price).toBe(195.42);
  });

  it('validates an Entity with nested fields', () => {
    const entity = {
      id: 'entity-123',
      name: 'Apple Inc.',
      type: 'COMPANY',
      tickers: ['AAPL'],
      domain: 'apple.com',
      country: 'US',
      market: {
        quote: {
          ticker: 'AAPL',
          price: 195.42,
          change: 1.92,
          changePercent: 0.99,
          volume: 45e6,
          timestamp: '2026-03-23T16:00:00Z',
          source: 'Alpha Vantage',
        },
        fundamentals: {
          peRatio: 28.5,
          eps: 6.85,
          beta: 1.2,
          sector: 'Technology',
          source: 'Alpha Vantage',
        },
      },
      news: [
        {
          title: 'Apple Q1 Beat',
          link: 'https://example.com/1',
          source: 'Serper',
          date: '2026-03-23T10:00:00Z',
          snippet: 'Beat expectations...',
        },
      ],
      risk: {
        overallScore: 15,
        signals: [],
        sanctionsHits: 0,
        adverseMediaHits: 2,
        regulatoryActions: 0,
      },
    };
    const parsed = EntitySchema.parse(entity);
    expect(parsed.id).toBe('entity-123');
    expect(parsed.market?.quote?.price).toBe(195.42);
  });

  it('rejects entity with empty id', () => {
    expect(() => EntitySchema.parse({ id: '', name: 'X', type: 'COMPANY' })).toThrow();
  });
});

describe('JintelClient.searchEntities', () => {
  it('returns matched entities on success', async () => {
    const entities = [
      { id: 'e1', name: 'Apple Inc.', type: 'COMPANY', tickers: ['AAPL'], domain: 'apple.com', country: 'US' },
      { id: 'e2', name: 'Alphabet Inc.', type: 'COMPANY', tickers: ['GOOGL'], domain: 'abc.xyz', country: 'US' },
    ];
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: { searchEntities: entities } }));

    const client = makeClient();
    const result = await client.searchEntities('tech');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0].name).toBe('Apple Inc.');
      expect(result.data[1].tickers).toEqual(['GOOGL']);
    }
  });

  it('sends correct Authorization header', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: { searchEntities: [] } }));

    const client = makeClient({ apiKey: 'my-secret-key' });
    await client.searchEntities('test');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, init] = mockFetch.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer my-secret-key');
  });

  it('returns empty array when no results', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: { searchEntities: [] } }));

    const client = makeClient();
    const result = await client.searchEntities('nonexistent');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });
});

describe('JintelClient.enrichEntity', () => {
  it('returns enriched entity with selected fields', async () => {
    const entity = {
      id: 'e1',
      name: 'Apple Inc.',
      type: 'COMPANY',
      tickers: ['AAPL'],
      domain: 'apple.com',
      country: 'US',
      market: {
        quote: {
          ticker: 'AAPL',
          price: 195.42,
          change: 1.92,
          changePercent: 0.99,
          volume: 45e6,
          timestamp: '2026-03-23T16:00:00Z',
          source: 'Alpha Vantage',
        },
      },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: { entity } }));

    const client = makeClient();
    const result = await client.enrichEntity('AAPL', ['market']);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('e1');
      expect(result.data.market?.quote?.price).toBe(195.42);
    }
  });

  it('returns success false when entity not found', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: { entity: null } }));

    const client = makeClient();
    const result = await client.enrichEntity('UNKNOWN');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('not found');
    }
  });
});

describe('JintelClient.quotes', () => {
  it('returns batch quotes for multiple tickers', async () => {
    const quotes = [
      {
        ticker: 'AAPL',
        price: 195.42,
        change: 1.92,
        changePercent: 0.99,
        volume: 45e6,
        timestamp: '2026-03-23T16:00:00Z',
        source: 'AV',
      },
      {
        ticker: 'GOOGL',
        price: 140.0,
        change: -0.5,
        changePercent: -0.36,
        volume: 20e6,
        timestamp: '2026-03-23T16:00:00Z',
        source: 'AV',
      },
    ];
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: { quotes } }));

    const client = makeClient();
    const result = await client.quotes(['AAPL', 'GOOGL']);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0].ticker).toBe('AAPL');
      expect(result.data[1].ticker).toBe('GOOGL');
    }
  });
});

describe('JintelClient error handling', () => {
  it('returns auth error on 401', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ errors: [{ message: 'Unauthorized' }] }, 401));

    const client = makeClient();
    const result = await client.searchEntities('test');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/auth|unauthorized/i);
    }
  });

  it('returns auth error on GraphQL UNAUTHENTICATED code', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        data: null,
        errors: [{ message: 'Not authenticated', extensions: { code: 'UNAUTHENTICATED' } }],
      }),
    );

    const client = makeClient();
    const result = await client.searchEntities('test');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/auth|unauthenticated/i);
    }
  });

  it('returns unreachable error on fetch rejection', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

    const client = makeClient();
    const result = await client.searchEntities('test');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/unreachable|fetch failed/i);
    }
  });

  it('returns generic error on HTTP 500', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ errors: [{ message: 'Internal Server Error' }] }, 500));

    const client = makeClient();
    const result = await client.searchEntities('test');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/500|server error/i);
    }
  });
});

describe('JintelClient.healthCheck', () => {
  it('returns healthy true when API responds', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: { __typename: 'Query' } }));

    const client = makeClient();
    const result = await client.healthCheck();

    expect(result.healthy).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns healthy false when API is down', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

    const client = makeClient();
    const result = await client.healthCheck();

    expect(result.healthy).toBe(false);
    expect(result.error).toBeDefined();
  });
});
