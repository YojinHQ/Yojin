/**
 * Polymarket API connector — fetches open prediction market positions.
 *
 * Auth: API key.
 * Endpoints: GET /positions, GET /markets
 */

import type { SecretVault } from '../../../trust/vault/types.js';
import type { ExtractedPosition, PlatformConnectorResult, TieredPlatformConnector } from '../../types.js';

// ---------------------------------------------------------------------------
// Polymarket API response types
// ---------------------------------------------------------------------------

interface PolymarketPosition {
  market_id: string;
  title: string;
  outcome: string;
  size: number;
  avg_price: number;
  current_price: number;
  pnl: number;
}

interface PolymarketPositionsResponse {
  positions: PolymarketPosition[];
}

// ---------------------------------------------------------------------------
// PolymarketApiConnector
// ---------------------------------------------------------------------------

const POLYMARKET_API_BASE = 'https://gamma-api.polymarket.com';

export class PolymarketApiConnector implements TieredPlatformConnector {
  readonly platformId = 'POLYMARKET';
  readonly platformName = 'Polymarket';
  readonly tier = 'API' as const;

  private apiKey = '';

  constructor(private readonly vault: SecretVault) {}

  async isAvailable(): Promise<boolean> {
    return this.vault.has('POLYMARKET_API_KEY');
  }

  async connect(_credentialRefs: string[]): Promise<{ success: boolean; error?: string }> {
    try {
      this.apiKey = await this.vault.get('POLYMARKET_API_KEY');

      // Validate by fetching positions
      const resp = await this.authenticatedRequest('GET', '/positions');
      if (!resp.ok) {
        const body = await resp.text();
        return { success: false, error: `Polymarket auth failed (${resp.status}): ${body}` };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Connection failed' };
    }
  }

  async disconnect(): Promise<void> {
    this.apiKey = '';
  }

  async fetchPositions(): Promise<PlatformConnectorResult> {
    try {
      const resp = await this.authenticatedRequest('GET', '/positions');
      if (!resp.ok) {
        throw new Error(`Polymarket API error (${resp.status}): ${await resp.text()}`);
      }

      const body = (await resp.json()) as PolymarketPositionsResponse;

      const positions: ExtractedPosition[] = body.positions.map((p) => ({
        symbol: `POLY-${p.market_id.slice(0, 8)}`,
        name: `${p.title} (${p.outcome})`,
        quantity: p.size,
        costBasis: p.avg_price * p.size,
        currentPrice: p.current_price,
        marketValue: p.current_price * p.size,
        unrealizedPnl: p.pnl,
        assetClass: 'OTHER' as const,
      }));

      return {
        success: true,
        positions,
        metadata: {
          source: 'API',
          platform: 'POLYMARKET',
          extractedAt: new Date().toISOString(),
          confidence: 0.95,
          positionConfidences: positions.map((p) => ({
            symbol: p.symbol,
            confidence: 0.95,
            fieldsExtracted: 6,
            fieldsExpected: 8,
            consistencyCheck: true,
          })),
          warnings: [],
        },
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to fetch positions' };
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async authenticatedRequest(method: string, path: string): Promise<Response> {
    return fetch(`${POLYMARKET_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }
}
