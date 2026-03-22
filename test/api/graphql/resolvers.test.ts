import { beforeEach, describe, expect, it } from 'vitest';

import { resetAlertStore } from '../../../src/api/graphql/resolvers/alerts.js';
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
  beforeEach(() => {
    resetAlertStore();
  });

  describe('Query.portfolio', () => {
    it('returns a portfolio snapshot (empty when no data imported)', async () => {
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
      expect(result.data?.portfolio).toBeDefined();

      const portfolio = result.data!.portfolio as Record<string, unknown>;
      expect(portfolio.positions).toBeInstanceOf(Array);
      expect(typeof portfolio.totalValue).toBe('number');
    });
  });

  describe('Query.positions', () => {
    it('returns an array of positions (empty when no data imported)', async () => {
      const result = await executeQuery(`
        query {
          positions {
            symbol
            name
            quantity
            costBasis
            currentPrice
            marketValue
            unrealizedPnl
          }
        }
      `);

      expect(result.errors).toBeUndefined();
      const positions = result.data!.positions as unknown[];
      expect(positions).toBeInstanceOf(Array);
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

  describe('Query.sectorExposure', () => {
    it('returns sector weights', async () => {
      const result = await executeQuery(`
        query {
          sectorExposure {
            sector
            weight
            value
          }
        }
      `);

      expect(result.errors).toBeUndefined();
      const sectors = result.data!.sectorExposure as Array<{ weight: number }>;
      expect(sectors.length).toBeGreaterThan(0);

      const totalWeight = sectors.reduce((sum, s) => sum + s.weight, 0);
      expect(totalWeight).toBeCloseTo(1.0, 1);
    });
  });

  describe('Query.alerts', () => {
    it('returns all alerts', async () => {
      const result = await executeQuery(`
        query {
          alerts {
            id
            status
            message
            rule {
              type
              symbol
            }
          }
        }
      `);

      expect(result.errors).toBeUndefined();
      const alerts = result.data!.alerts as unknown[];
      expect(alerts.length).toBeGreaterThan(0);
    });

    it('filters alerts by status', async () => {
      const result = await executeQuery(`
        query {
          alerts(status: ACTIVE) {
            id
            status
          }
        }
      `);

      expect(result.errors).toBeUndefined();
      const alerts = result.data!.alerts as Array<{ status: string }>;
      for (const alert of alerts) {
        expect(alert.status).toBe('ACTIVE');
      }
    });
  });

  describe('Query.enrichedSnapshot', () => {
    it('returns enriched snapshot with enrichedAt timestamp', async () => {
      const result = await executeQuery(`
        query {
          enrichedSnapshot {
            id
            enrichedAt
            totalValue
            positions {
              symbol
              sentimentScore
              sentimentLabel
              analystRating
              targetPrice
              beta
            }
          }
        }
      `);

      expect(result.errors).toBeUndefined();
      const snapshot = result.data!.enrichedSnapshot as Record<string, unknown>;
      expect(snapshot.enrichedAt).toBeDefined();
      expect(snapshot.positions).toBeInstanceOf(Array);
    });
  });

  describe('Mutation.createAlert', () => {
    it('creates a new alert', async () => {
      const result = await executeQuery(`
        mutation {
          createAlert(rule: { type: PRICE_MOVE, symbol: "MSFT", threshold: 3.0, direction: BOTH }) {
            id
            status
            message
            rule {
              type
              symbol
              threshold
              direction
            }
          }
        }
      `);

      expect(result.errors).toBeUndefined();
      const alert = result.data!.createAlert as Record<string, unknown>;
      expect(alert.status).toBe('ACTIVE');
      expect(alert.rule).toEqual({
        type: 'PRICE_MOVE',
        symbol: 'MSFT',
        threshold: 3.0,
        direction: 'BOTH',
      });
    });
  });

  describe('Mutation.dismissAlert', () => {
    it('dismisses an existing alert', async () => {
      const result = await executeQuery(`
        mutation {
          dismissAlert(id: "alert-001") {
            id
            status
            dismissedAt
          }
        }
      `);

      expect(result.errors).toBeUndefined();
      const alert = result.data!.dismissAlert as Record<string, unknown>;
      expect(alert.status).toBe('DISMISSED');
      expect(alert.dismissedAt).toBeDefined();
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
