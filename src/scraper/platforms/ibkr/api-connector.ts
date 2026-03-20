/**
 * IBKR API connector — fetches portfolio via Client Portal API.
 *
 * The IBKR Client Portal Gateway runs locally on the user's machine.
 * Auth: Gateway must be authenticated (user logs in via browser).
 * Endpoints: GET /portfolio/accounts, GET /portfolio/{accountId}/positions
 */

import type { SecretVault } from '../../../trust/vault/types.js';
import type { ExtractedPosition, PlatformConnectorResult, TieredPlatformConnector } from '../../types.js';

// ---------------------------------------------------------------------------
// IBKR Client Portal API response types
// ---------------------------------------------------------------------------

interface IbkrAccount {
  id: string;
  accountId: string;
  type: string;
}

interface IbkrPosition {
  acctId: string;
  conid: number;
  contractDesc: string;
  position: number;
  mktPrice: number;
  mktValue: number;
  unrealizedPnl: number;
  currency: string;
  assetClass: string;
  ticker?: string;
}

// ---------------------------------------------------------------------------
// IbkrApiConnector
// ---------------------------------------------------------------------------

export class IbkrApiConnector implements TieredPlatformConnector {
  readonly platformId = 'INTERACTIVE_BROKERS';
  readonly platformName = 'Interactive Brokers';
  readonly tier = 'API' as const;

  private gatewayUrl = '';

  constructor(private readonly vault: SecretVault) {}

  async isAvailable(): Promise<boolean> {
    // IBKR Client Portal API needs a gateway port configured
    return this.vault.has('IBKR_GATEWAY_PORT');
  }

  async connect(_credentialRefs: string[]): Promise<{ success: boolean; error?: string }> {
    try {
      const port = await this.vault.get('IBKR_GATEWAY_PORT');
      this.gatewayUrl = `https://localhost:${port}/v1/api`;

      // Validate by checking auth status
      const resp = await this.gatewayRequest('GET', '/iserver/auth/status');
      if (!resp.ok) {
        return { success: false, error: `IBKR gateway not reachable on port ${port}` };
      }
      const status = (await resp.json()) as { authenticated: boolean };
      if (!status.authenticated) {
        return { success: false, error: 'IBKR gateway not authenticated — please log in via the Client Portal' };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Connection failed' };
    }
  }

  async disconnect(): Promise<void> {
    this.gatewayUrl = '';
  }

  async fetchPositions(): Promise<PlatformConnectorResult> {
    try {
      // Get account IDs
      const accountsResp = await this.gatewayRequest('GET', '/portfolio/accounts');
      if (!accountsResp.ok) {
        throw new Error(`IBKR accounts error (${accountsResp.status}): ${await accountsResp.text()}`);
      }
      const accounts = (await accountsResp.json()) as IbkrAccount[];

      if (accounts.length === 0) {
        return { success: false, error: 'No IBKR accounts found' };
      }

      // Fetch positions for each account
      const allPositions: ExtractedPosition[] = [];

      for (const account of accounts) {
        const posResp = await this.gatewayRequest('GET', `/portfolio/${account.accountId}/positions/0`);
        if (!posResp.ok) continue;

        const positions = (await posResp.json()) as IbkrPosition[];
        for (const pos of positions) {
          allPositions.push({
            symbol: pos.ticker ?? pos.contractDesc,
            name: pos.contractDesc,
            quantity: pos.position,
            currentPrice: pos.mktPrice,
            marketValue: pos.mktValue,
            unrealizedPnl: pos.unrealizedPnl,
            assetClass: this.mapAssetClass(pos.assetClass),
          });
        }
      }

      return {
        success: true,
        positions: allPositions,
        metadata: {
          source: 'API',
          platform: 'INTERACTIVE_BROKERS',
          extractedAt: new Date().toISOString(),
          confidence: 1,
          positionConfidences: allPositions.map((p) => ({
            symbol: p.symbol,
            confidence: 1,
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

  private async gatewayRequest(method: string, path: string): Promise<Response> {
    return fetch(`${this.gatewayUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private mapAssetClass(ibkrClass: string): ExtractedPosition['assetClass'] {
    const mapping: Record<string, ExtractedPosition['assetClass']> = {
      STK: 'EQUITY',
      BOND: 'BOND',
      CASH: 'CURRENCY',
      CMDTY: 'COMMODITY',
      CRYPTO: 'CRYPTO',
    };
    return mapping[ibkrClass] ?? 'OTHER';
  }
}
