import { describe, expect, it } from 'vitest';

import { yoga } from '../../../src/api/graphql/server.js';

/** Helper — execute a GraphQL query against the yoga instance. */
async function executeQuery(query: string, variables?: Record<string, unknown>) {
  const body = JSON.stringify({ query, variables });
  const request = new Request('http://localhost:3000/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  const response = await yoga.fetch(request, {});
  const json = (await response.json()) as { data?: Record<string, unknown>; errors?: unknown[] };
  return json;
}

describe('GraphQL resolvers', () => {
  describe('Query.portfolio', () => {
    it('returns null when no snapshots exist', async () => {
      const result = await executeQuery(`
        query {
          portfolio {
            id
            totalValue
            totalPnl
            positions {
              symbol
              name
              currentPrice
              marketValue
              assetClass
            }
          }
        }
      `);

      expect(result.errors).toBeUndefined();
      expect(result.data?.portfolio).toBeNull();
    });
  });

  describe('Query.quote', () => {
    it('returns a quote for a known symbol', async () => {
      const result = await executeQuery(`
        query {
          quote(symbol: "AAPL") {
            symbol
            price
            change
            changePercent
            volume
          }
        }
      `);

      expect(result.errors).toBeUndefined();
      const quote = result.data!.quote as Record<string, unknown>;
      expect(quote.symbol).toBe('AAPL');
      expect(quote.price).toBeGreaterThan(0);
    });

    it('returns null for an unknown symbol', async () => {
      const result = await executeQuery(`
        query {
          quote(symbol: "UNKNOWN") {
            symbol
            price
          }
        }
      `);

      expect(result.errors).toBeUndefined();
      expect(result.data!.quote).toBeNull();
    });
  });

  describe('Query.news', () => {
    it('returns all articles when no filter', async () => {
      const result = await executeQuery(`
        query {
          news {
            id
            title
            source
            symbols
            sentiment
          }
        }
      `);

      expect(result.errors).toBeUndefined();
      const articles = result.data!.news as unknown[];
      expect(articles.length).toBeGreaterThan(0);
    });

    it('filters articles by symbol', async () => {
      const result = await executeQuery(`
        query {
          news(symbol: "AAPL") {
            id
            title
            symbols
          }
        }
      `);

      expect(result.errors).toBeUndefined();
      const articles = result.data!.news as Array<{ symbols: string[] }>;
      for (const article of articles) {
        expect(article.symbols).toContain('AAPL');
      }
    });

    it('respects the limit parameter', async () => {
      const result = await executeQuery(`
        query {
          news(limit: 1) {
            id
            title
          }
        }
      `);

      expect(result.errors).toBeUndefined();
      const articles = result.data!.news as unknown[];
      expect(articles.length).toBe(1);
    });
  });

  describe('Query.riskReport', () => {
    it('returns a risk report', async () => {
      const result = await executeQuery(`
        query {
          riskReport {
            id
            portfolioValue
            concentrationScore
            maxDrawdown
            valueAtRisk
            sectorExposure {
              sector
              weight
              value
            }
            topConcentrations {
              symbol
              weight
            }
            correlationClusters {
              symbols
              correlation
            }
          }
        }
      `);

      expect(result.errors).toBeUndefined();
      const report = result.data!.riskReport as Record<string, unknown>;
      expect(report.portfolioValue).toBeGreaterThan(0);
      expect(report.concentrationScore).toBeGreaterThan(0);
    });
  });

  describe('Query.alerts', () => {
    it('returns empty array when no AlertStore is wired', async () => {
      const result = await executeQuery(`
        query {
          alerts {
            id
            status
            thesis
            symbol
            severity
            severityLabel
          }
        }
      `);

      expect(result.errors).toBeUndefined();
      const alerts = result.data!.alerts as unknown[];
      expect(alerts).toEqual([]);
    });

    it('accepts status filter', async () => {
      const result = await executeQuery(`
        query {
          alerts(status: ACTIVE) {
            id
            status
          }
        }
      `);

      expect(result.errors).toBeUndefined();
      const alerts = result.data!.alerts as unknown[];
      expect(alerts).toEqual([]);
    });
  });

  describe('Mutation.dismissAlert', () => {
    it('returns error when AlertStore is not wired', async () => {
      const result = await executeQuery(`
        mutation {
          dismissAlert(id: "alert-001") {
            id
            status
            dismissedAt
          }
        }
      `);

      // Without an AlertStore wired, the resolver throws
      expect(result.errors).toBeDefined();
    });
  });

  describe('Mutation.refreshPositions', () => {
    it('refreshes positions for a platform', async () => {
      const result = await executeQuery(`
        mutation {
          refreshPositions(platform: "INTERACTIVE_BROKERS") {
            id
            totalValue
            positions {
              symbol
              platform
            }
          }
        }
      `);

      expect(result.errors).toBeUndefined();
      const snapshot = result.data!.refreshPositions as Record<string, unknown>;
      expect(typeof snapshot.totalValue).toBe('number');
      expect(snapshot.positions).toBeInstanceOf(Array);
    });
  });
});
