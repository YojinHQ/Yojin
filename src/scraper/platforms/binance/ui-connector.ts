/**
 * Binance UI connector — Playwright browser automation.
 *
 * Scrapes portfolio from Binance web UI when API keys aren't available.
 * Login: email/password → 2FA → portfolio page.
 */

import type { Page } from 'playwright';

import { screenshotOnFailure, stealthDelay } from '../../pw-helpers.js';
import type { SessionStore } from '../../session-store.js';
import type { BrowserLike, ExtractedPosition, PlatformConnectorResult, TieredPlatformConnector } from '../../types.js';

// ---------------------------------------------------------------------------
// BinanceUiConnector
// ---------------------------------------------------------------------------

export class BinanceUiConnector implements TieredPlatformConnector {
  readonly platformId = 'BINANCE';
  readonly platformName = 'Binance';
  readonly tier = 'UI' as const;

  private page: Page | null = null;

  constructor(
    private readonly browser: BrowserLike,
    private readonly sessionStore: SessionStore,
    private readonly cacheDir: string,
  ) {}

  async isAvailable(): Promise<boolean> {
    // Browser tier is always available — user logs in manually.
    // A saved session just means we can skip the login step.
    return true;
  }

  async connect(_credentialRefs: string[]): Promise<{ success: boolean; error?: string }> {
    try {
      // Close any existing page/context to avoid resource leaks on repeated connect() calls
      await this.disconnect();

      const context = await this.browser.newContext({
        viewport: { width: 1400, height: 900 },
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });
      this.page = await context.newPage();

      // Try to restore session
      const session = await this.sessionStore.load('BINANCE');
      if (session) {
        await context.addCookies(session.cookies);
      }

      // Navigate to Binance portfolio
      await this.page.goto('https://www.binance.com/en/my/wallet/account/overview');
      await stealthDelay({ minDelay: 2000, maxDelay: 3000 });

      // Check if we're redirected to login
      const url = this.page.url();
      if (url.includes('login') || url.includes('Login')) {
        // Wait for the user to log in manually in the visible browser.
        // Poll until the URL no longer contains "login" (max 5 minutes).
        await this.waitForManualLogin();
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
  }

  async fetchPositions(): Promise<PlatformConnectorResult> {
    if (!this.page) {
      return { success: false, error: 'Not connected — call connect() first' };
    }

    try {
      // Navigate to spot wallet (skip if already there from login flow)
      const currentUrl = this.page.url();
      if (!currentUrl.includes('/my/wallet') && !currentUrl.includes('/my/dashboard')) {
        await this.page.goto('https://www.binance.com/en/my/wallet/account/overview');
      }
      await stealthDelay({ minDelay: 3000, maxDelay: 5000 });

      // Dismiss cookie consent if present
      try {
        const cookieBtn = this.page.locator('#onetrust-accept-btn-handler');
        if (await cookieBtn.isVisible({ timeout: 2000 })) {
          await cookieBtn.click();
          await stealthDelay({ minDelay: 500, maxDelay: 1000 });
        }
      } catch {
        // No cookie banner — continue
      }

      // Wait for the page to settle — Binance uses dynamic class names so
      // CSS selectors are unreliable. Instead, wait for page content to render
      // by checking for "Estimated Balance" or "My Assets" text via evaluate.
      let loaded = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        const hasContent = await this.page.evaluate(() => {
          const text = document.body.innerText;
          return text.includes('Estimated Balance') || text.includes('My Assets') || text.includes('Total Balance');
        });
        if (hasContent) {
          loaded = true;
          break;
        }
        await stealthDelay({ minDelay: 2000, maxDelay: 3000 });
      }

      if (!loaded) {
        await screenshotOnFailure(this.page, 'binance', this.cacheDir);
        return { success: false, error: 'Portfolio page did not load — may need re-authentication' };
      }

      const allPositions = await this.parsePositions();
      // Only keep positions with positive quantity
      const positions = allPositions.filter((p) => (p.quantity ?? 0) > 0);

      // Save session for next time
      const cookies = await this.page.context().cookies();
      await this.sessionStore.save('BINANCE', {
        cookies,
        savedAt: new Date().toISOString(),
      });

      return {
        success: true,
        positions,
        metadata: {
          source: 'UI',
          platform: 'BINANCE',
          extractedAt: new Date().toISOString(),
          confidence: 0.8,
          positionConfidences: positions.map((p) => ({
            symbol: p.symbol,
            confidence: 0.8,
            fieldsExtracted: Object.keys(p).filter((k) => p[k as keyof ExtractedPosition] != null).length,
            fieldsExpected: 8,
            consistencyCheck: true,
          })),
          warnings: ['Positions scraped from Binance UI — values may have minor delays'],
        },
      };
    } catch (err) {
      if (this.page) {
        await screenshotOnFailure(this.page, 'binance', this.cacheDir);
      }
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to fetch positions',
      };
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Wait for the user to complete login manually in the visible browser.
   * Polls the page URL every 2s for up to 5 minutes.
   */
  private async waitForManualLogin(): Promise<void> {
    if (!this.page) throw new Error('No page');

    const maxWaitMs = 5 * 60 * 1000; // 5 minutes
    const pollIntervalMs = 2000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));

      const url = this.page.url();
      // Positive match: wallet/dashboard pages mean login is done
      const isWalletPage = url.includes('/my/wallet') || url.includes('/my/dashboard') || url.includes('/portfolio');
      // Negative match: still on a login-related page
      const isLoginPage = url.includes('login') || url.includes('Login') || url.includes('accounts.binance');

      if (isWalletPage || !isLoginPage) {
        await stealthDelay({ minDelay: 1000, maxDelay: 2000 });
        return;
      }
    }

    throw new Error('Login timed out — please log in within 5 minutes');
  }

  private async parsePositions(): Promise<ExtractedPosition[]> {
    if (!this.page) return [];

    // Give the page time to fully render dynamic content
    await stealthDelay({ minDelay: 2000, maxDelay: 3000 });

    // Scroll down multiple times to ensure all assets are loaded (Binance lazy-loads)
    for (let scroll = 0; scroll < 5; scroll++) {
      await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await stealthDelay({ minDelay: 800, maxDelay: 1500 });
    }
    // Scroll back to top to ensure header rows are in view
    await this.page.evaluate(() => window.scrollTo(0, 0));
    await stealthDelay({ minDelay: 500, maxDelay: 1000 });

    // Use page.evaluate with a string to avoid tsx/esbuild injecting __name
    // helper into the browser context where it doesn't exist.
    //
    // Instead of a hardcoded ticker list, we accept any uppercase word that
    // matches a crypto ticker pattern (1-10 alphanumeric chars, starts with a
    // letter or digit). We exclude common UI words to avoid false positives.
    // Use a curated ticker allowlist instead of pattern matching.
    // Pattern-based matching picks up UI labels (SETTINGS, DELISTED, SWAPPED)
    // and full coin names (TETHERUS, ZCASH) as false positives.
    const raw = await this.page.evaluate(`(() => {
      var positions = [];

      var TICKERS = [
        'BTC','ETH','BNB','SOL','XRP','ADA','DOGE','DOT','AVAX','MATIC','POL',
        'LINK','UNI','ATOM','LTC','NEAR','TRX','ARB','OP','APT','SUI','SEI',
        'PEPE','SHIB','FLOKI','BONK','WIF','USDT','USDC','BUSD','DAI','FDUSD','TUSD',
        'FIL','ICP','IMX','RENDER','INJ','FET','OCEAN','AGIX','LDO','MKR','AAVE',
        'CRV','SNX','COMP','GRT','FTM','SAND','MANA','AXS','GALA','ENJ','APE',
        'XLM','ALGO','VET','EGLD','HBAR','QNT','ZEC','EOS','FLOW','THETA','IOTA',
        'NEO','KAVA','ONE','ZIL','TIA','JTO','JUP','PYTH','WLD','STRK','DYM',
        'ORDI','SATS','1000SATS','RATS','RUNE','STX','TON','NOT','KAS','TAO','AR',
        'CFX','ACH','PENDLE','W','ENA','ETHFI','BOME','WEN','TNSR','KMNO',
        'IO','ZRO','LISTA','BB','REZ','AEVO','SAGA','OMNI','PIXEL','PORTAL',
        'MANTA','ALT','XAI','NFP','ACE','LQTY','BLUR','ID','EDU','SUI','CYBER',
        'MAV','ARKM','YGG','SEI','WBETH','CAKE','GMT','MASK','CHZ','CELR',
        'DYDX','TWT','SSV','COTI','RSR','ANKR','BAND','BAL','KNC','LRC','SKL',
        'AUDIO','ENS','API3','PERP','REN','SXP','ALPHA','BADGER','REEF','POLS',
        'SUPER','CHESS','RARE','HIGH','HOOK','LEVER','KEY','VOXEL','SPELL',
        'ARP','RAD','JASMY','ROSE','GAS','STORJ','CTSI','POWR','REQ','WING',
        'TROY','SCRT','PIVX','DOCK','STEEM','HARD','SYS','PROM','WRX','OGN',
        'MDT','DREP','SUN','BTT','WIN','BTTC','JST','ASTR','GLMR','MOVR',
        'BEAM','RONIN','RON','AXL','DIA','CLV','KDA','FLUX','ZEN','SC','DCR',
        'RVN','XEC','CELO','MINA','ICX','ONT','QTUM','WAVES','DASH','XMR',
        'BSV','BCH','ETC','FTT','LUNA','LUNC','UST','USTC','CKB','AGLD',
        'NTRN','OSMO','INJ','BICO','OMG','ZRX','1INCH','SUSHI','YFI','DODO',
        'SFP','PEOPLE','LOOM','ALICE','TLM','SANTOS','LAZIO','CITY','BAR',
        'JUV','PSG','OG','ATM','ASR','PHA','BEL','FOR','IDEX','POND',
        'ACA','XNO','MBOX','DEGO','BETA','FORTH','FARM','QUICK','GHST',
        'FIDA','ORCA','MNGO','STEP','SBR','PORT','COPE','MAPS','SLIM','OXY',
        'RAY','SRM','ATLAS','POLIS','GST','GMT','FITFI','VELO','DF','MULTI',
        'PHB','PROS','QI','BURGER','NULS','NKN','ARDR','STMX','VITE','XVS',
        'TKO','BAKE','ALPACA','ELF','IRIS','COCOS','MFT','DENT','HOT','FUN',
        'CVC','MTL','OXT','NMR','DNT','RLC','IOTX','LSK','POLY','CTXC',
        'PERL','TOMO','DATA','SC','SNT','ADX','AERGO','AMB','ARNM','WAXP',
        'HIFI','COMBO','MAV','ARK','BOND','FRONT','TRU','LIT','UNFI','DAR',
        'FIRO','KMD','STRAX','XVG','VIB','SLP','C98','DUSK','MBL','MOVEZ',
        'T','LOKA','BSW','GMX','STG','RDNT','JOE','GNS','GRAIL','PENDLE',
        'RPL','FXS','SD','ANKR','SSV','SSVETH','RETH','CBETH','STETH','WSTETH',
        'LQO','SHR','LQR','LQT','SHI','DEC','SHB'
      ];
      var knownTickers = new Set(TICKERS);

      // Binance uses div-based layouts, not HTML tables.
      // Each asset is a block of lines in the page text:
      //   TICKER            ← known ticker (e.g., "MATIC")
      //   Name/Status       ← full name or status labels (skip)
      //   1,173.01301865    ← quantity (plain number with commas)
      //   $249.78           ← USD market value (starts with $)
      //   ...               ← price, cost, PnL lines (skip)
      var allText = document.body.innerText;
      var lines = allText.split('\\n').map(function(l) { return l.trim(); }).filter(Boolean);

      for (var i = 0; i < lines.length; i++) {
        // A ticker line is a single known ticker word (possibly with status text)
        var lineUpper = lines[i].toUpperCase();
        var lineWords = lineUpper.split(/\\s+/);
        if (lineWords.length > 3) continue; // skip long lines (not a ticker line)

        var ticker = null;
        for (var w = 0; w < lineWords.length; w++) {
          if (knownTickers.has(lineWords[w])) { ticker = lineWords[w]; break; }
        }
        if (!ticker) continue;

        // Look ahead for quantity (plain number) and value ($xxx)
        var quantity = undefined;
        var marketValue = undefined;
        for (var j = i + 1; j < Math.min(i + 8, lines.length); j++) {
          var ahead = lines[j];

          // Stop if we hit another ticker (start of next asset)
          var aheadWords = ahead.toUpperCase().split(/\\s+/);
          if (aheadWords.length <= 3) {
            var nextTicker = false;
            for (var aw = 0; aw < aheadWords.length; aw++) {
              if (knownTickers.has(aheadWords[aw])) { nextTicker = true; break; }
            }
            if (nextTicker && j > i + 1) break;
          }

          // Match quantity: plain number with optional commas (e.g., "1,173.01301865")
          if (quantity === undefined && /^[0-9][0-9,.]*$/.test(ahead)) {
            quantity = parseFloat(ahead.replace(/,/g, ''));
          }

          // Match USD value: starts with $ (e.g., "$249.78")
          if (marketValue === undefined && /^\\$[0-9,.]+$/.test(ahead)) {
            marketValue = parseFloat(ahead.replace(/[\\$,]/g, ''));
          }

          // If we found both, stop looking
          if (quantity !== undefined && marketValue !== undefined) break;
        }

        if (quantity === undefined || quantity <= 0) continue;

        positions.push({
          symbol: ticker,
          quantity: quantity,
          marketValue: marketValue || 0,
          assetClass: 'CRYPTO'
        });
      }

      // Deduplicate by symbol — keep first occurrence
      var seen = {};
      var deduped = positions.filter(function(p) {
        if (seen[p.symbol]) return false;
        seen[p.symbol] = true;
        return true;
      });
      return deduped;
    })()`);

    return raw as ExtractedPosition[];
  }
}
