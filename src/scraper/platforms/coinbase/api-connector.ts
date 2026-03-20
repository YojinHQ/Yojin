/**
 * Coinbase API connector — fetches portfolio via Coinbase REST API v2.
 *
 * Auth: API key + secret (HMAC-SHA256 request signing).
 * Endpoints: GET /v2/accounts (paginated), GET /v2/exchange-rates
 */

import { createHmac } from 'node:crypto';

import type { SecretVault } from '../../../trust/vault/types.js';
import type { ExtractedPosition, PlatformConnectorResult, TieredPlatformConnector } from '../../types.js';

// ---------------------------------------------------------------------------
// Coinbase API response types
// ---------------------------------------------------------------------------

interface CoinbaseAccount {
  id: string;
  name: string;
  balance: { amount: string; currency: string };
  native_balance: { amount: string; currency: string };
  type: string;
}

interface CoinbasePagination {
  ending_before: string | null;
  starting_after: string | null;
  limit: number;
  order: string;
  next_uri: string | null;
}

interface CoinbaseAccountsResponse {
  data: CoinbaseAccount[];
  pagination: CoinbasePagination;
}

// ---------------------------------------------------------------------------
// CoinbaseApiConnector
// ---------------------------------------------------------------------------

const COINBASE_API_BASE = 'https://api.coinbase.com';

export class CoinbaseApiConnector implements TieredPlatformConnector {
  readonly platformId = 'COINBASE';
  readonly platformName = 'Coinbase';
  readonly tier = 'API' as const;

  private apiKey = '';
  private apiSecret = '';

  constructor(private readonly vault: SecretVault) {}

  async isAvailable(): Promise<boolean> {
    return (await this.vault.has('COINBASE_API_KEY')) && (await this.vault.has('COINBASE_API_SECRET'));
  }

  async connect(_credentialRefs: string[]): Promise<{ success: boolean; error?: string }> {
    try {
      this.apiKey = await this.vault.get('COINBASE_API_KEY');
      this.apiSecret = await this.vault.get('COINBASE_API_SECRET');

      // Validate credentials by fetching the first page
      const resp = await this.signedRequest('GET', '/v2/accounts?limit=1');
      if (!resp.ok) {
        const body = await resp.text();
        return { success: false, error: `Coinbase auth failed (${resp.status}): ${body}` };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Connection failed' };
    }
  }

  async disconnect(): Promise<void> {
    this.apiKey = '';
    this.apiSecret = '';
  }

  async fetchPositions(): Promise<PlatformConnectorResult> {
    try {
      const accounts = await this.fetchAllAccounts();

      const positions: ExtractedPosition[] = accounts
        .filter((a) => parseFloat(a.balance.amount) > 0)
        .map((a) => ({
          symbol: a.balance.currency,
          name: a.name,
          quantity: parseFloat(a.balance.amount),
          marketValue: parseFloat(a.native_balance.amount),
          currentPrice:
            parseFloat(a.balance.amount) > 0
              ? parseFloat(a.native_balance.amount) / parseFloat(a.balance.amount)
              : undefined,
          assetClass: 'CRYPTO' as const,
        }));

      return {
        success: true,
        positions,
        metadata: {
          source: 'API',
          platform: 'COINBASE',
          extractedAt: new Date().toISOString(),
          confidence: 1,
          positionConfidences: positions.map((p) => ({
            symbol: p.symbol,
            confidence: 1,
            fieldsExtracted: 4,
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

  private async fetchAllAccounts(): Promise<CoinbaseAccount[]> {
    const allAccounts: CoinbaseAccount[] = [];
    let nextUri: string | null = '/v2/accounts?limit=100';

    while (nextUri) {
      const resp = await this.signedRequest('GET', nextUri);
      if (!resp.ok) {
        throw new Error(`Coinbase API error (${resp.status}): ${await resp.text()}`);
      }
      const body = (await resp.json()) as CoinbaseAccountsResponse;
      allAccounts.push(...body.data);
      nextUri = body.pagination.next_uri;
    }

    return allAccounts;
  }

  private async signedRequest(method: string, path: string, body?: string): Promise<Response> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const message = timestamp + method.toUpperCase() + path + (body ?? '');
    const signature = createHmac('sha256', this.apiSecret).update(message).digest('hex');

    return fetch(`${COINBASE_API_BASE}${path}`, {
      method,
      headers: {
        'CB-ACCESS-KEY': this.apiKey,
        'CB-ACCESS-SIGN': signature,
        'CB-ACCESS-TIMESTAMP': timestamp,
        'CB-VERSION': '2024-01-01',
        'Content-Type': 'application/json',
      },
      body: body ?? undefined,
    });
  }
}
