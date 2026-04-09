/**
 * Lazy Playwright browser — launches on first use.
 *
 * Avoids importing Playwright at startup (which would fail if browsers
 * aren't installed) and avoids the cost of launching a browser process
 * until a UI-tier connector actually needs one.
 */

import type { Browser, BrowserContext } from 'playwright';

import type { BrowserLike } from './types.js';

export class LazyBrowser implements BrowserLike {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;

  private async getBrowser(): Promise<Browser> {
    if (this.browser) return this.browser;

    // Deduplicate concurrent launch requests
    if (!this.launching) {
      this.launching = (async () => {
        let chromium: typeof import('playwright').chromium;
        try {
          ({ chromium } = await import('playwright'));
        } catch {
          throw new Error(
            'Platform scraping requires Playwright. Install it with `npm install playwright` and then `npx playwright install chromium`.',
          );
        }
        const browser = await chromium.launch({
          headless: false,
          args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox'],
        });
        this.browser = browser;
        return browser;
      })();
    }

    return this.launching;
  }

  /** Proxy for Browser.newContext() — launches Playwright on first call. */
  async newContext(...args: Parameters<Browser['newContext']>): Promise<BrowserContext> {
    const browser = await this.getBrowser();
    return browser.newContext(...args);
  }

  /** Close the browser if it was launched. */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.launching = null;
    }
  }
}
