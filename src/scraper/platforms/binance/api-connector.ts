/**
 * Binance API connector — fetches spot portfolio via Binance REST API.
 *
 * Auth: API key + HMAC-SHA256 signed requests.
 * Endpoints: GET /api/v3/account, GET /api/v3/ticker/price
 */

import { createHmac } from 'node:crypto';

import type { SecretVault } from '../../../trust/vault/types.js';
import type { ExtractedPosition, PlatformConnectorResult, TieredPlatformConnector } from '../../types.js';

// ---------------------------------------------------------------------------
// Binance API response types
// ---------------------------------------------------------------------------

interface BinanceBalance {
  asset: string;
  free: string;
  locked: string;
}

interface BinanceAccountResponse {
  balances: BinanceBalance[];
}

interface BinanceTickerPrice {
  symbol: string;
  price: string;
}

// ---------------------------------------------------------------------------
// BinanceApiConnector
// ---------------------------------------------------------------------------

const BINANCE_API_BASE = 'https://api.binance.com';

export class BinanceApiConnector implements TieredPlatformConnector {
  readonly platformId = 'BINANCE';
  readonly platformName = 'Binance';
  readonly tier = 'API' as const;

  private apiKey = '';
  private apiSecret = '';

  constructor(private readonly vault: SecretVault) {}

  async isAvailable(): Promise<boolean> {
    return (await this.vault.has('BINANCE_API_KEY')) && (await this.vault.has('BINANCE_API_SECRET'));
  }

  async connect(_credentialRefs: string[]): Promise<{ success: boolean; error?: string }> {
    try {
      this.apiKey = await this.vault.get('BINANCE_API_KEY');
      this.apiSecret = await this.vault.get('BINANCE_API_SECRET');

      // Validate credentials by fetching account info
      const resp = await this.signedRequest('GET', '/api/v3/account');
      if (!resp.ok) {
        const body = await resp.text();
        return { success: false, error: `Binance auth failed (${resp.status}): ${body}` };
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
      // Fetch account balances
      const accountResp = await this.signedRequest('GET', '/api/v3/account');
      if (!accountResp.ok) {
        throw new Error(`Binance account error (${accountResp.status}): ${await accountResp.text()}`);
      }
      const account = (await accountResp.json()) as BinanceAccountResponse;

      // Filter to non-zero balances
      const nonZero = account.balances.filter((b) => {
        const total = parseFloat(b.free) + parseFloat(b.locked);
        return total > 0;
      });

      if (nonZero.length === 0) {
        return {
          success: true,
          positions: [],
          metadata: this.buildMetadata([]),
        };
      }

      // Fetch current prices for held assets
      const priceMap = await this.fetchPrices();

      const positions: ExtractedPosition[] = nonZero.map((b) => {
        const quantity = parseFloat(b.free) + parseFloat(b.locked);
        const usdtSymbol = `${b.asset}USDT`;
        const price = priceMap.get(usdtSymbol);
        const currentPrice = price ? parseFloat(price) : undefined;
        const marketValue = currentPrice ? quantity * currentPrice : undefined;

        // Stablecoins are valued at $1
        const isStable = ['USDT', 'USDC', 'BUSD', 'DAI', 'TUSD'].includes(b.asset);
        return {
          symbol: b.asset,
          quantity,
          currentPrice: isStable ? 1 : currentPrice,
          marketValue: isStable ? quantity : marketValue,
          assetClass: 'CRYPTO' as const,
        };
      });

      return {
        success: true,
        positions,
        metadata: this.buildMetadata(positions),
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to fetch positions' };
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async fetchPrices(): Promise<Map<string, string>> {
    const resp = await fetch(`${BINANCE_API_BASE}/api/v3/ticker/price`);
    if (!resp.ok) {
      throw new Error(`Binance ticker error (${resp.status})`);
    }
    const tickers = (await resp.json()) as BinanceTickerPrice[];
    return new Map(tickers.map((t) => [t.symbol, t.price]));
  }

  private async signedRequest(method: string, path: string): Promise<Response> {
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;
    const signature = createHmac('sha256', this.apiSecret).update(queryString).digest('hex');

    const url = `${BINANCE_API_BASE}${path}?${queryString}&signature=${signature}`;
    return fetch(url, {
      method,
      headers: { 'X-MBX-APIKEY': this.apiKey },
    });
  }

  private buildMetadata(positions: ExtractedPosition[]) {
    return {
      source: 'API' as const,
      platform: 'BINANCE' as const,
      extractedAt: new Date().toISOString(),
      confidence: 1,
      positionConfidences: positions.map((p) => ({
        symbol: p.symbol,
        confidence: 1,
        fieldsExtracted: p.currentPrice ? 4 : 2,
        fieldsExpected: 8,
        consistencyCheck: true,
      })),
      warnings: [],
    };
  }
}
