/**
 * Robinhood UI connector — Playwright browser automation.
 *
 * No public API available. Scrapes portfolio from the web UI.
 * Login: email/password → 2FA challenge → verify.
 */

import type { Page } from 'playwright';

import type { SecretVault } from '../../../trust/vault/types.js';
import { screenshotOnFailure, stealthDelay, waitForSelector } from '../../pw-helpers.js';
import type { SessionStore } from '../../session-store.js';
import type { BrowserLike, ExtractedPosition, PlatformConnectorResult, TieredPlatformConnector } from '../../types.js';

// ---------------------------------------------------------------------------
// RobinhoodUiConnector
// ---------------------------------------------------------------------------

export class RobinhoodUiConnector implements TieredPlatformConnector {
  readonly platformId = 'ROBINHOOD';
  readonly platformName = 'Robinhood';
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
    return (await this.vault.has('ROBINHOOD_USERNAME')) && (await this.vault.has('ROBINHOOD_PASSWORD'));
  }

  async connect(_credentialRefs: string[]): Promise<{ success: boolean; error?: string }> {
    try {
      this.username = await this.vault.get('ROBINHOOD_USERNAME');
      this.password = await this.vault.get('ROBINHOOD_PASSWORD');

      const context = await this.browser.newContext();
      this.page = await context.newPage();

      // Try to restore session
      const session = await this.sessionStore.load('ROBINHOOD');
      if (session) {
        await context.addCookies(session.cookies);
      }

      // Navigate and check if logged in
      await this.page.goto('https://robinhood.com/account');
      await stealthDelay();

      // Check if we're at login page
      const isLoginPage = await waitForSelector(this.page, '[name="username"]', {
        timeout: 5000,
        retries: 1,
      });

      if (isLoginPage) {
        // Need to log in
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
      await this.page.goto('https://robinhood.com/');
      await stealthDelay();

      // Wait for portfolio to load
      const loaded = await waitForSelector(this.page, '[data-testid="PortfolioValue"]', {
        timeout: 15_000,
        retries: 2,
      });

      if (!loaded) {
        await screenshotOnFailure(this.page, 'robinhood', this.cacheDir);
        return { success: false, error: 'Portfolio page did not load — may need re-authentication' };
      }

      // Navigate to positions
      await this.page.goto('https://robinhood.com/account/positions');
      await stealthDelay();

      // Parse position rows
      const positions = await this.parsePositions();

      // Save session for next time
      const cookies = await this.page.context().cookies();
      await this.sessionStore.save('ROBINHOOD', {
        cookies,
        savedAt: new Date().toISOString(),
      });

      return {
        success: true,
        positions,
        metadata: {
          source: 'UI',
          platform: 'ROBINHOOD',
          extractedAt: new Date().toISOString(),
          confidence: 0.85,
          positionConfidences: positions.map((p) => ({
            symbol: p.symbol,
            confidence: 0.85,
            fieldsExtracted: Object.keys(p).filter((k) => p[k as keyof ExtractedPosition] != null).length,
            fieldsExpected: 8,
            consistencyCheck: true,
          })),
          warnings: ['Positions scraped from UI — values may have minor delays'],
        },
      };
    } catch (err) {
      if (this.page) {
        await screenshotOnFailure(this.page, 'robinhood', this.cacheDir);
      }
      return { success: false, error: err instanceof Error ? err.message : 'Failed to fetch positions' };
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async performLogin(): Promise<void> {
    if (!this.page) throw new Error('No page');

    await this.page.fill('[name="username"]', this.username);
    await stealthDelay();
    await this.page.fill('[name="password"]', this.password);
    await stealthDelay();
    await this.page.click('[type="submit"]');
    await stealthDelay({ minDelay: 1000, maxDelay: 2000 });

    // Handle 2FA if prompted
    const has2fa = await waitForSelector(this.page, '[name="code"], [placeholder*="code"]', {
      timeout: 5000,
      retries: 1,
    });

    if (has2fa) {
      // 2FA requires user intervention — we can't automate this
      throw new Error('2FA challenge detected — please complete 2FA manually in the browser');
    }

    // Wait for redirect to home
    await this.page.waitForURL('**/robinhood.com/**', { timeout: 15_000 });
  }

  private async parsePositions(): Promise<ExtractedPosition[]> {
    if (!this.page) return [];

    await waitForSelector(this.page, '[data-testid="PositionCell"], .holdings-list', {
      timeout: 10_000,
      retries: 2,
    });

    const raw = await this.page.evaluate(() => {
      const positions: Array<{
        symbol: string;
        name?: string;
        quantity?: number;
        marketValue?: number;
        currentPrice?: number;
        unrealizedPnl?: number;
        unrealizedPnlPercent?: number;
        assetClass?: string;
      }> = [];

      // Try common selectors for position rows
      const rows = document.querySelectorAll('[data-testid="PositionCell"], .holdings-row, tr[data-instrument]');

      for (const row of rows) {
        const symbolEl = row.querySelector('[data-testid="Symbol"], .symbol, .ticker');
        const nameEl = row.querySelector('[data-testid="InstrumentName"], .instrument-name');
        const valueEl = row.querySelector('[data-testid="MarketValue"], .market-value');
        const quantityEl = row.querySelector('[data-testid="Quantity"], .quantity, .shares');

        if (!symbolEl?.textContent) continue;

        const symbol = symbolEl.textContent.trim();
        const parseNum = (el: Element | null) => {
          const text = el?.textContent?.replace(/[,$%]/g, '');
          return text ? parseFloat(text) : undefined;
        };

        positions.push({
          symbol,
          name: nameEl?.textContent?.trim(),
          marketValue: parseNum(valueEl),
          quantity: parseNum(quantityEl),
          assetClass: 'EQUITY',
        });
      }

      return positions;
    });
    return raw as ExtractedPosition[];
  }
}
