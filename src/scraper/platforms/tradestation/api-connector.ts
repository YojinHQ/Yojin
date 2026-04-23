/**
 * TradeStation API connector — fetches portfolio via TradeStation REST API v3.
 *
 * Auth: OAuth 2.0 Authorization Code flow. The client_id, client_secret, and a
 * long-lived refresh_token are stored in the vault (the refresh_token is
 * obtained once via `yojin tradestation-auth`). Each sync exchanges the
 * refresh_token for a short-lived access_token (20 min) via the token
 * endpoint, then calls the brokerage endpoints with Authorization: Bearer.
 *
 * Endpoints: GET /v3/brokerage/accounts, GET /v3/brokerage/accounts/{ids}/positions
 */

import { z } from 'zod';

import type { SecretVault } from '../../../trust/vault/types.js';
import type {
  ExtractedPosition,
  ExtractionMetadata,
  PlatformConnectorResult,
  TieredPlatformConnector,
} from '../../types.js';

// ---------------------------------------------------------------------------
// TradeStation API endpoints
// ---------------------------------------------------------------------------

const TOKEN_URL = 'https://signin.tradestation.com/oauth/token';
const API_BASE = 'https://api.tradestation.com';

// ---------------------------------------------------------------------------
// TradeStation API response schemas — validated on every call. Don't trust
// the wire, even when the HTTP status is 200: a shape change upstream would
// otherwise surface as a generic `TypeError: Cannot read properties of
// undefined` deep inside the mapping code instead of a clear error.
// ---------------------------------------------------------------------------

const AccountSchema = z
  .object({
    AccountID: z.string().min(1),
  })
  .passthrough();

const AccountsResponseSchema = z
  .object({
    Accounts: z.array(AccountSchema).optional().default([]),
  })
  .passthrough();

const PositionSchema = z
  .object({
    AccountID: z.string().min(1),
    AssetType: z.string().min(1),
    Symbol: z.string().min(1),
    Quantity: z.string().optional(),
    AveragePrice: z.string().optional(),
    Last: z.string().optional(),
    MarketValue: z.string().optional(),
    TotalCost: z.string().optional(),
    UnrealizedProfitLoss: z.string().optional(),
    UnrealizedProfitLossPercent: z.string().optional(),
  })
  .passthrough();

const PositionErrorSchema = z
  .object({
    AccountID: z.string(),
    Error: z.string(),
    Message: z.string(),
  })
  .passthrough();

const PositionsResponseSchema = z
  .object({
    Positions: z.array(PositionSchema).optional().default([]),
    Errors: z.array(PositionErrorSchema).optional(),
  })
  .passthrough();

// Validated on every refresh — don't trust the wire.
const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  token_type: z.string().optional(),
  scope: z.string().optional(),
  id_token: z.string().optional(),
  refresh_token: z.string().optional(), // Only present in rotating mode
});
type TokenResponse = z.infer<typeof TokenResponseSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a TradeStation numeric string; returns undefined for missing/malformed values. */
function num(s: string | undefined): number | undefined {
  if (s == null) return undefined;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}

/** Map TradeStation AssetType to Yojin's AssetClass enum (no OPTION/FUTURE values today). */
function mapAssetClass(assetType: string): 'EQUITY' | 'OTHER' {
  return assetType === 'STOCK' ? 'EQUITY' : 'OTHER';
}

// ---------------------------------------------------------------------------
// TradeStationApiConnector
// ---------------------------------------------------------------------------

export class TradeStationApiConnector implements TieredPlatformConnector {
  readonly platformId = 'TRADESTATION';
  readonly platformName = 'TradeStation';
  readonly tier = 'API' as const;

  private clientId = '';
  private clientSecret = '';
  private accessToken = '';
  private accessTokenExpiresAt = 0;
  // Surfaces rotation / degraded-path warnings on the next fetchPositions() call.
  private pendingWarnings: string[] = [];
  // Single-flight guard — all refresh callers funnel through ensureAccessToken().
  private refreshInFlight: Promise<void> | null = null;

  constructor(private readonly vault: SecretVault) {}

  async isAvailable(): Promise<boolean> {
    return (
      (await this.vault.has('TRADESTATION_CLIENT_ID')) &&
      (await this.vault.has('TRADESTATION_CLIENT_SECRET')) &&
      (await this.vault.has('TRADESTATION_REFRESH_TOKEN'))
    );
  }

  async connect(_credentialRefs: string[]): Promise<{ success: boolean; error?: string }> {
    try {
      this.clientId = await this.vault.get('TRADESTATION_CLIENT_ID');
      this.clientSecret = await this.vault.get('TRADESTATION_CLIENT_SECRET');
      await this.ensureAccessToken(true);
      return { success: true };
    } catch (err) {
      this.clientId = '';
      this.clientSecret = '';
      this.clearTokenState();
      return { success: false, error: err instanceof Error ? err.message : 'Connection failed' };
    }
  }

  async disconnect(): Promise<void> {
    this.clientId = '';
    this.clientSecret = '';
    this.clearTokenState();
    this.pendingWarnings = [];
  }

  async fetchPositions(): Promise<PlatformConnectorResult> {
    try {
      const accountsResp = await this.authedGet(
        '/v3/brokerage/accounts',
        AccountsResponseSchema,
        'GET /v3/brokerage/accounts',
      );
      const ids = accountsResp.Accounts.map((a) => a.AccountID).join(',');

      if (!ids) {
        return this.buildResult([], []);
      }

      const resp = await this.authedGet(
        `/v3/brokerage/accounts/${ids}/positions`,
        PositionsResponseSchema,
        'GET /v3/brokerage/accounts/{ids}/positions',
      );

      const warnings: string[] = [];
      for (const e of resp.Errors ?? []) {
        warnings.push(`TradeStation account ${e.AccountID}: ${e.Error} — ${e.Message}`);
      }

      const positions: ExtractedPosition[] = resp.Positions.filter((p) => {
        const qty = num(p.Quantity);
        return qty !== undefined && qty !== 0;
      }).map((p) => {
        const out: ExtractedPosition = {
          symbol: p.Symbol,
          assetClass: mapAssetClass(p.AssetType),
        };
        const quantity = num(p.Quantity);
        if (quantity !== undefined) out.quantity = quantity;
        // Yojin's `costBasis` is per-share (see position-table.tsx:94 —
        // `totalCost = reduce((s, p) => s + p.costBasis * p.quantity)`).
        // TradeStation's `TotalCost` is the full dollar cost of the lot,
        // not per-share — using it here caused a 10,500-share position to
        // report a cost of $10,500 × $130,659 ≈ $1.37B and a -99.99% loss.
        // `AveragePrice` is the per-share average cost.
        const costBasis = num(p.AveragePrice);
        if (costBasis !== undefined) out.costBasis = costBasis;
        const currentPrice = num(p.Last);
        if (currentPrice !== undefined) out.currentPrice = currentPrice;
        const marketValue = num(p.MarketValue);
        if (marketValue !== undefined) out.marketValue = marketValue;
        const unrealizedPnl = num(p.UnrealizedProfitLoss);
        if (unrealizedPnl !== undefined) out.unrealizedPnl = unrealizedPnl;
        const unrealizedPnlPercent = num(p.UnrealizedProfitLossPercent);
        if (unrealizedPnlPercent !== undefined) out.unrealizedPnlPercent = unrealizedPnlPercent;
        return out;
      });

      return this.buildResult(positions, warnings);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to fetch positions' };
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private buildResult(positions: ExtractedPosition[], extraWarnings: string[]): PlatformConnectorResult {
    // Drain pendingWarnings (e.g. rotation notices) into this sync's metadata.
    const warnings = [...this.pendingWarnings, ...extraWarnings];
    this.pendingWarnings = [];

    const metadata: ExtractionMetadata = {
      source: 'API',
      platform: 'TRADESTATION',
      extractedAt: new Date().toISOString(),
      confidence: 1,
      positionConfidences: positions.map((p) => ({
        symbol: p.symbol,
        confidence: 1,
        fieldsExtracted: 4,
        fieldsExpected: 8,
        consistencyCheck: true,
      })),
      warnings,
    };
    return { success: true, positions, metadata };
  }

  private async ensureAccessToken(forceRefresh = false): Promise<void> {
    if (!forceRefresh && this.accessToken && Date.now() < this.accessTokenExpiresAt) return;
    if (this.refreshInFlight) {
      await this.refreshInFlight;
      return;
    }
    this.refreshInFlight = this.doRefresh().finally(() => {
      this.refreshInFlight = null;
    });
    await this.refreshInFlight;
  }

  private async doRefresh(): Promise<void> {
    const refresh = await this.vault.get('TRADESTATION_REFRESH_TOKEN');
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refresh,
    });

    let resp: Response;
    try {
      resp = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch (err) {
      this.clearTokenState();
      throw err;
    }

    if (!resp.ok) {
      this.clearTokenState();
      const text = await resp.text();
      const hint = resp.status === 400 ? ' Run `yojin tradestation-auth` to re-authenticate.' : '';
      throw new Error(`TradeStation token refresh failed (${resp.status}): ${text}.${hint}`);
    }

    const parsed = TokenResponseSchema.safeParse(await resp.json());
    if (!parsed.success) {
      this.clearTokenState();
      throw new Error(`TradeStation token response malformed: ${parsed.error.message}`);
    }

    // CRITICAL ORDERING: if the refresh token rotated, persist the new one to
    // the vault BEFORE committing the new access_token. TradeStation invalidated
    // the old refresh_token the moment it issued the new one — if vault.set()
    // fails after we commit access_token, we'd return success with a live
    // session while the vault still holds a now-invalid refresh_token, locking
    // the user out on next process restart.
    const data: TokenResponse = parsed.data;
    const rotatedToken =
      data.refresh_token !== undefined && data.refresh_token !== refresh ? data.refresh_token : undefined;
    if (rotatedToken !== undefined) {
      try {
        await this.vault.set('TRADESTATION_REFRESH_TOKEN', rotatedToken);
      } catch (err) {
        this.clearTokenState();
        throw new Error(
          `TradeStation issued a rotated refresh_token but persisting it to the vault failed: ${
            err instanceof Error ? err.message : String(err)
          }. The old refresh_token is now invalid. Run \`yojin tradestation-auth\` to re-authenticate.`,
          { cause: err },
        );
      }
      this.pendingWarnings.push('TradeStation rotated refresh token — persisted to vault');
    }

    this.accessToken = data.access_token;
    this.accessTokenExpiresAt = Date.now() + data.expires_in * 1000 - 60_000;
  }

  private clearTokenState(): void {
    this.accessToken = '';
    this.accessTokenExpiresAt = 0;
  }

  private async authedGet<T>(path: string, schema: z.ZodType<T>, label: string): Promise<T> {
    await this.ensureAccessToken();

    let resp = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${this.accessToken}`, Accept: 'application/json' },
    });

    if (resp.status === 401) {
      // Race: token expired/rotated between ensureAccessToken() and this call.
      await this.ensureAccessToken(true);
      resp = await fetch(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${this.accessToken}`, Accept: 'application/json' },
      });
      if (resp.status === 401) {
        this.clearTokenState();
        throw new Error(`TradeStation API ${path} (401 after forced refresh): ${await resp.text()}`);
      }
    }

    if (!resp.ok) {
      throw new Error(`TradeStation API ${path} (${resp.status}): ${await resp.text()}`);
    }

    const parsed = schema.safeParse(await resp.json());
    if (!parsed.success) {
      throw new Error(`TradeStation ${label} response malformed: ${parsed.error.message}`);
    }
    return parsed.data;
  }
}
