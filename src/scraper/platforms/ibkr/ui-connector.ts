/**
 * IBKR UI connector — Playwright browser automation for Client Portal web.
 *
 * Used as fallback when Client Portal Gateway API isn't running.
 * Login: username/password → security device challenge.
 */

import type { Page } from 'playwright';

import type { SecretVault } from '../../../trust/vault/types.js';
import { screenshotOnFailure, stealthDelay, waitForSelector } from '../../pw-helpers.js';
import type { SessionStore } from '../../session-store.js';
import type { BrowserLike, ExtractedPosition, PlatformConnectorResult, TieredPlatformConnector } from '../../types.js';

// ---------------------------------------------------------------------------
// IbkrUiConnector
// ---------------------------------------------------------------------------

export class IbkrUiConnector implements TieredPlatformConnector {
  readonly platformId = 'INTERACTIVE_BROKERS';
  readonly platformName = 'Interactive Brokers';
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
    return (await this.vault.has('IBKR_USERNAME')) && (await this.vault.has('IBKR_PASSWORD'));
  }

  async connect(_credentialRefs: string[]): Promise<{ success: boolean; error?: string }> {
    try {
      this.username = await this.vault.get('IBKR_USERNAME');
      this.password = await this.vault.get('IBKR_PASSWORD');

      const context = await this.browser.newContext();
      this.page = await context.newPage();

      // Try to restore session
      const session = await this.sessionStore.load('INTERACTIVE_BROKERS');
      if (session) {
        await context.addCookies(session.cookies);
      }

      // Navigate to Client Portal
      await this.page.goto('https://ndcdyn.interactivebrokers.com/sso/Login');
      await stealthDelay();

      // Check if we need to log in
      const isLoginPage = await waitForSelector(this.page, '#user_name, [name="username"]', {
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
      // Navigate to portfolio page
      await this.page.goto('https://ndcdyn.interactivebrokers.com/AccountManagement/AmAuthentication?action=Portfolio');
      await stealthDelay();

      const loaded = await waitForSelector(
        this.page,
        '.portfolio-positions, table.positions, [data-testid="positions"]',
        {
          timeout: 15_000,
          retries: 2,
        },
      );

      if (!loaded) {
        await screenshotOnFailure(this.page, 'ibkr', this.cacheDir);
        return { success: false, error: 'Portfolio page did not load — may need re-authentication' };
      }

      const positions = await this.parsePositions();

      // Save session
      const cookies = await this.page.context().cookies();
      await this.sessionStore.save('INTERACTIVE_BROKERS', {
        cookies,
        savedAt: new Date().toISOString(),
      });

      return {
        success: true,
        positions,
        metadata: {
          source: 'UI',
          platform: 'INTERACTIVE_BROKERS',
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
        await screenshotOnFailure(this.page, 'ibkr', this.cacheDir);
      }
      return { success: false, error: err instanceof Error ? err.message : 'Failed to fetch positions' };
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async performLogin(): Promise<void> {
    if (!this.page) throw new Error('No page');

    await this.page.fill('#user_name, [name="username"]', this.username);
    await stealthDelay();
    await this.page.fill('#password, [name="password"]', this.password);
    await stealthDelay();
    await this.page.click('#submitForm, [type="submit"]');
    await stealthDelay({ minDelay: 2000, maxDelay: 4000 });

    // IBKR uses security device (IB Key) — requires manual approval
    const securityChallenge = await waitForSelector(
      this.page,
      '.security-device, #securityChallenge, [data-testid="two-factor"]',
      { timeout: 5000, retries: 1 },
    );

    if (securityChallenge) {
      throw new Error('Security device challenge detected — please approve on your IB Key mobile app');
    }
  }

  private async parsePositions(): Promise<ExtractedPosition[]> {
    if (!this.page) return [];

    const raw = await this.page.evaluate(() => {
      const positions: Array<{
        symbol: string;
        name?: string;
        quantity?: number;
        currentPrice?: number;
        marketValue?: number;
        unrealizedPnl?: number;
        assetClass?: string;
      }> = [];

      const rows = document.querySelectorAll('tr.position-row, .portfolio-position, [data-testid="position-row"]');

      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 3) continue;

        const parseNum = (el: Element | null) => {
          const text = el?.textContent?.replace(/[,$%]/g, '').trim();
          return text ? parseFloat(text) : undefined;
        };

        const symbol = cells[0]?.textContent?.trim();
        if (!symbol) continue;

        positions.push({
          symbol,
          name: cells[1]?.textContent?.trim(),
          quantity: parseNum(cells[2] ?? null),
          currentPrice: parseNum(cells[3] ?? null),
          marketValue: parseNum(cells[4] ?? null),
          unrealizedPnl: parseNum(cells[5] ?? null),
          assetClass: 'EQUITY',
        });
      }

      return positions;
    });
    return raw as ExtractedPosition[];
  }
}
