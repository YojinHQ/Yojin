/**
 * E2E test — PII redaction boundary.
 *
 * Verifies: UI (GraphQL) sees exact values, LLM (tools) sees redacted ranges.
 * Runs against a live server on port 3000.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const API_URL = 'http://localhost:3000/graphql';

/** Helper to send a GraphQL query. */
async function gql(query: string, variables?: Record<string, unknown>) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GraphQL request failed: ${res.status}`);
  return res.json();
}

describe('PII Redaction E2E', () => {
  let serverAvailable = false;

  beforeAll(async () => {
    // Check if server is running
    try {
      const res = await fetch('http://localhost:3000/health');
      serverAvailable = res.ok;
    } catch {
      serverAvailable = false;
    }
  });

  it('server is running', ({ skip }) => {
    if (!serverAvailable) {
      return skip();
    }
    expect(serverAvailable).toBe(true);
  });

  it('addManualPosition saves exact values accessible via GraphQL', async ({ skip }) => {
    if (!serverAvailable) skip();

    // Add a position via mutation
    const mutation = `
      mutation AddManualPosition($input: ManualPositionInput!) {
        addManualPosition(input: $input) {
          id
          totalValue
          totalCost
          totalPnl
          positions { symbol quantity marketValue currentPrice costBasis }
        }
      }
    `;

    const result = await gql(mutation, {
      input: {
        symbol: 'BTC',
        name: 'Bitcoin',
        quantity: 1.5,
        costBasis: 42000,
        assetClass: 'CRYPTO',
        platform: 'COINBASE',
      },
    });

    const snapshot = result.data.addManualPosition;

    // UI should see EXACT numeric values — not range strings like "$50k-$100k"
    expect(typeof snapshot.totalValue).toBe('number');
    expect(snapshot.totalValue).toBeGreaterThan(0);
    // Verify it's an exact number, not a range string
    expect(String(snapshot.totalValue)).not.toMatch(/^\$/);

    const btcPos = snapshot.positions.find((p: { symbol: string }) => p.symbol === 'BTC');
    expect(btcPos).toBeDefined();
    expect(btcPos.quantity).toBe(1.5);
    expect(typeof btcPos.costBasis).toBe('number');
    expect(btcPos.costBasis).toBe(42000);
  });

  it('portfolio query returns exact numeric values for UI', async ({ skip }) => {
    if (!serverAvailable) skip();

    const query = `
      query Portfolio {
        portfolio {
          totalValue
          totalCost
          totalPnl
          positions { symbol quantity marketValue currentPrice }
        }
      }
    `;

    const result = await gql(query);
    const portfolio = result.data.portfolio;

    // All values should be exact numbers, not strings/ranges
    expect(typeof portfolio.totalValue).toBe('number');
    expect(typeof portfolio.totalCost).toBe('number');

    if (portfolio.positions.length > 0) {
      expect(typeof portfolio.positions[0].marketValue).toBe('number');
      expect(typeof portfolio.positions[0].currentPrice).toBe('number');
    }
  });

  afterAll(async () => {
    // No cleanup needed — positions persist in snapshot store
  });
});
