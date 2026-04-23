/**
 * Fidelity UI connector — Playwright browser automation.
 *
 * No public API. Scrapes portfolio from the Fidelity web UI.
 * Login: username/password.
 */

import type { Page } from 'playwright';

import { CRYPTO_SYMBOLS } from '../../../portfolio/crypto-symbols.js';
import type { SecretVault } from '../../../trust/vault/types.js';
import { screenshotOnFailure, stealthDelay, waitForSelector } from '../../pw-helpers.js';
import type { SessionStore } from '../../session-store.js';
import type { BrowserLike, ExtractedPosition, PlatformConnectorResult, TieredPlatformConnector } from '../../types.js';

// ---------------------------------------------------------------------------
// FidelityUiConnector
// ---------------------------------------------------------------------------

export class FidelityUiConnector implements TieredPlatformConnector {
  readonly platformId = 'FIDELITY';
  readonly platformName = 'Fidelity';
  readonly tier = 'UI' as const;

  private username = '';
  private password = '';
  private page: Page | null = null;

  constructor(
    private readonly vault: SecretVault,
    private readonly browser: BrowserLike,
    private readonly sessionStore: SessionStore,
    private readonly cacheDir: string,
  ) {}

  async isAvailable(): Promise<boolean> {
    return (await this.vault.has('FIDELITY_USERNAME')) && (await this.vault.has('FIDELITY_PASSWORD'));
  }

  async connect(_credentialRefs: string[]): Promise<{ success: boolean; error?: string }> {
    try {
      this.username = await this.vault.get('FIDELITY_USERNAME');
      this.password = await this.vault.get('FIDELITY_PASSWORD');

      const context = await this.browser.newContext();
      this.page = await context.newPage();

      // Try to restore session
      const session = await this.sessionStore.load('FIDELITY');
      if (session) {
        await context.addCookies(session.cookies);
      }

      // Navigate to Fidelity
      await this.page.goto('https://digital.fidelity.com/prgw/digital/login/full-page');
      await stealthDelay();

      // Check if we need to log in
      const isLoginPage = await waitForSelector(this.page, '#userId, [name="username"]', {
        timeout: 5000,
        retries: 1,
      });

      if (isLoginPage) {
        await this.performLogin();
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Connection failed' };
    }
  }

  async disconnect(): Promise<void> {
    if (this.page) {
      const context = this.page.context();
      await this.page.close();
      await context.close();
      this.page = null;
    }
    this.username = '';
    this.password = '';
  }

  async fetchPositions(): Promise<PlatformConnectorResult> {
    if (!this.page) {
      return { success: false, error: 'Not connected — call connect() first' };
    }

    try {
      await this.page.goto('https://digital.fidelity.com/ftgw/digital/portfolio/positions');
      await stealthDelay();

      const loaded = await waitForSelector(
        this.page,
        '.portfolio-positions, .ag-body, [data-testid="positions-table"]',
        {
          timeout: 15_000,
          retries: 2,
        },
      );

      if (!loaded) {
        await screenshotOnFailure(this.page, 'fidelity', this.cacheDir);
        return { success: false, error: 'Portfolio page did not load — may need re-authentication' };
      }

      const positions = await this.parsePositions();

      // Save session
      const cookies = await this.page.context().cookies();
      await this.sessionStore.save('FIDELITY', {
        cookies,
        savedAt: new Date().toISOString(),
      });

      return {
        success: true,
        positions,
        metadata: {
          source: 'UI',
          platform: 'FIDELITY',
          extractedAt: new Date().toISOString(),
          confidence: 0.8,
          positionConfidences: positions.map((p) => ({
            symbol: p.symbol,
            confidence: 0.8,
            fieldsExtracted: Object.keys(p).filter((k) => p[k as keyof ExtractedPosition] != null).length,
            fieldsExpected: 8,
            consistencyCheck: true,
          })),
          warnings: ['Positions scraped from UI — values may have minor delays'],
        },
      };
    } catch (err) {
      if (this.page) {
        await screenshotOnFailure(this.page, 'fidelity', this.cacheDir);
      }
      return { success: false, error: err instanceof Error ? err.message : 'Failed to fetch positions' };
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async performLogin(): Promise<void> {
    if (!this.page) throw new Error('No page');

    await this.page.fill('#userId, [name="username"]', this.username);
    await stealthDelay();
    await this.page.fill('#password, [name="password"]', this.password);
    await stealthDelay();
    await this.page.click('#fs-login-button, [type="submit"]');
    await stealthDelay({ minDelay: 2000, maxDelay: 4000 });

    // Wait for redirect
    await this.page.waitForURL('**/fidelity.com/**', { timeout: 15_000 });
  }

  private async parsePositions(): Promise<ExtractedPosition[]> {
    if (!this.page) return [];

    const cryptoList = [...CRYPTO_SYMBOLS];
    const raw = await this.page.evaluate((cryptoList) => {
      const cryptoSet = new Set(cryptoList);
      const positions: Array<{
        symbol: string;
        name?: string;
        quantity?: number;
        currentPrice?: number;
        marketValue?: number;
        costBasis?: number;
        unrealizedPnl?: number;
        unrealizedPnlPercent?: number;
        assetClass?: string;
      }> = [];

      const rows = document.querySelectorAll(
        '.portfolio-position-row, .ag-row, [data-testid="position-row"], tr.position',
      );

      for (const row of rows) {
        const symbolEl = row.querySelector('.stock-symbol, [data-testid="symbol"], .symbol-column');
        const nameEl = row.querySelector('.security-name, [data-testid="description"]');
        const quantityEl = row.querySelector('.quantity-column, [data-testid="quantity"]');
        const priceEl = row.querySelector('.last-price, [data-testid="lastPrice"]');
        const valueEl = row.querySelector('.market-value, [data-testid="currentValue"]');
        const costEl = row.querySelector('.cost-basis, [data-testid="costBasis"]');
        const pnlEl = row.querySelector('.gain-loss, [data-testid="gainLoss"]');

        if (!symbolEl?.textContent) continue;

        const parseNum = (el: Element | null) => {
          const text = el?.textContent?.replace(/[,$%()]/g, '').trim();
          return text ? parseFloat(text) : undefined;
        };

        const symbol = symbolEl.textContent.trim();
        const symbolUpper = symbol.toUpperCase();
        const base = /^([A-Z0-9]+)-(?:USDT?)$/.exec(symbolUpper)?.[1];
        const isCrypto = cryptoSet.has(symbolUpper) || (base !== undefined && cryptoSet.has(base));

        positions.push({
          symbol,
          name: nameEl?.textContent?.trim(),
          quantity: parseNum(quantityEl),
          currentPrice: parseNum(priceEl),
          marketValue: parseNum(valueEl),
          costBasis: parseNum(costEl),
          unrealizedPnl: parseNum(pnlEl),
          assetClass: isCrypto ? 'CRYPTO' : 'EQUITY',
        });
      }

      return positions;
    }, cryptoList);
    return raw as ExtractedPosition[];
  }
}
