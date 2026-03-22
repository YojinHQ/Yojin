/**
 * Coinbase UI connector — Playwright browser automation fallback.
 *
 * Used when API keys aren't configured. Automates the Coinbase web UI
 * to scrape portfolio data.
 */

import type { Page } from 'playwright';

import type { SecretVault } from '../../../trust/vault/types.js';
import { screenshotOnFailure, stealthDelay, waitForSelector } from '../../pw-helpers.js';
import type { SessionStore } from '../../session-store.js';
import type { BrowserLike, ExtractedPosition, PlatformConnectorResult, TieredPlatformConnector } from '../../types.js';

// ---------------------------------------------------------------------------
// CoinbaseUiConnector
// ---------------------------------------------------------------------------

export class CoinbaseUiConnector implements TieredPlatformConnector {
  readonly platformId = 'COINBASE';
  readonly platformName = 'Coinbase';
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
    return (await this.vault.has('COINBASE_USERNAME')) && (await this.vault.has('COINBASE_PASSWORD'));
  }

  async connect(_credentialRefs: string[]): Promise<{ success: boolean; error?: string }> {
    try {
      this.username = await this.vault.get('COINBASE_USERNAME');
      this.password = await this.vault.get('COINBASE_PASSWORD');

      const context = await this.browser.newContext();
      this.page = await context.newPage();

      // Try to restore session
      const session = await this.sessionStore.load('COINBASE');
      if (session) {
        await context.addCookies(session.cookies);
      }

      // Navigate to portfolio
      await this.page.goto('https://www.coinbase.com/portfolio');
      await stealthDelay();

      // Check if we need to log in
      const isLoginPage = await waitForSelector(this.page, '#email, [name="email"]', {
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
      await this.page.goto('https://www.coinbase.com/portfolio');
      await stealthDelay();

      const loaded = await waitForSelector(this.page, '[data-testid="asset-list"], .portfolio-assets', {
        timeout: 15_000,
        retries: 2,
      });

      if (!loaded) {
        await screenshotOnFailure(this.page, 'coinbase', this.cacheDir);
        return { success: false, error: 'Portfolio page did not load — may need re-authentication' };
      }

      const positions = await this.parsePositions();

      // Save session
      const cookies = await this.page.context().cookies();
      await this.sessionStore.save('COINBASE', {
        cookies,
        savedAt: new Date().toISOString(),
      });

      return {
        success: true,
        positions,
        metadata: {
          source: 'UI',
          platform: 'COINBASE',
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
        await screenshotOnFailure(this.page, 'coinbase', this.cacheDir);
      }
      return { success: false, error: err instanceof Error ? err.message : 'Failed to fetch positions' };
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async performLogin(): Promise<void> {
    if (!this.page) throw new Error('No page');

    await this.page.goto('https://login.coinbase.com/signin');
    await stealthDelay();

    await this.page.fill('#email, [name="email"]', this.username);
    await stealthDelay();
    await this.page.click('[type="submit"], button:has-text("Continue")');
    await stealthDelay();

    await waitForSelector(this.page, '#password, [name="password"]', { timeout: 10_000 });
    await this.page.fill('#password, [name="password"]', this.password);
    await stealthDelay();
    await this.page.click('[type="submit"], button:has-text("Sign in")');
    await stealthDelay({ minDelay: 1000, maxDelay: 2000 });

    // Handle 2FA if prompted
    const has2fa = await waitForSelector(this.page, '[name="code"], input[maxlength="6"]', {
      timeout: 5000,
      retries: 1,
    });

    if (has2fa) {
      throw new Error('2FA challenge detected — please complete 2FA manually in the browser');
    }

    await this.page.waitForURL('**/coinbase.com/**portfolio**', { timeout: 15_000 });
  }

  private async parsePositions(): Promise<ExtractedPosition[]> {
    if (!this.page) return [];

    const raw = await this.page.evaluate(() => {
      const positions: Array<{
        symbol: string;
        name?: string;
        quantity?: number;
        marketValue?: number;
        currentPrice?: number;
        assetClass?: string;
      }> = [];

      const rows = document.querySelectorAll('[data-testid="asset-row"], .asset-item, tr.asset-row');

      for (const row of rows) {
        const symbolEl = row.querySelector('[data-testid="asset-symbol"], .asset-symbol');
        const nameEl = row.querySelector('[data-testid="asset-name"], .asset-name');
        const balanceEl = row.querySelector('[data-testid="asset-balance"], .asset-balance');
        const valueEl = row.querySelector('[data-testid="asset-value"], .asset-value');

        if (!symbolEl?.textContent) continue;

        const parseNum = (el: Element | null) => {
          const text = el?.textContent?.replace(/[,$]/g, '');
          return text ? parseFloat(text) : undefined;
        };

        positions.push({
          symbol: symbolEl.textContent.trim(),
          name: nameEl?.textContent?.trim(),
          quantity: parseNum(balanceEl),
          marketValue: parseNum(valueEl),
          assetClass: 'CRYPTO',
        });
      }

      return positions;
    });
    return raw as ExtractedPosition[];
  }
}
