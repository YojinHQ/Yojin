/**
 * Claude OAuth magic-link flow using Playwright.
 *
 * Two-step process:
 *   1. startMagicLinkFlow(email)  — launch browser, navigate to Claude OAuth page, enter email
 *   2. completeMagicLinkFlow(url) — navigate to magic link URL, click Authorize, capture token
 *
 * Adapted from ai-team's Puppeteer-based ClaudeOAuthService.
 */

import type { Browser, Page } from 'playwright';

import {
  type ClaudeOAuthResult,
  buildClaudeOAuthUrl,
  exchangeClaudeOAuthCode,
  generatePkceParams,
} from './claude-oauth.js';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let browser: Browser | null = null;
let page: Page | null = null;
let pkceCodeVerifier = '';
let pkceState = '';
let flowInProgress = false;

const OAUTH_CALLBACK_URI = 'https://console.anthropic.com/oauth/code/callback';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function closeBrowser(): Promise<void> {
  try {
    if (browser) {
      await browser.close();
    }
  } catch {
    // best-effort
  }
  browser = null;
  page = null;
  pkceCodeVerifier = '';
  pkceState = '';
  flowInProgress = false;
}

/**
 * Try to dismiss cookie-consent banners that can block interaction.
 */
async function dismissCookieBanner(p: Page): Promise<void> {
  try {
    await p.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const accept = btns.find(
        (b) =>
          b.textContent?.toLowerCase().includes('accept all') ||
          b.textContent?.toLowerCase().includes('accept cookies'),
      );
      if (accept) (accept as HTMLElement).click();
    });
    await p.waitForTimeout(500);
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Step 1: Start flow — enter email on Claude OAuth page
// ---------------------------------------------------------------------------

export interface MagicLinkStartResult {
  success: boolean;
  error?: string;
}

export async function startMagicLinkFlow(email: string): Promise<MagicLinkStartResult> {
  if (flowInProgress) {
    return { success: false, error: 'A magic link flow is already in progress. Please wait or cancel it first.' };
  }

  // Close any existing session
  await closeBrowser();
  flowInProgress = true;

  try {
    const { chromium } = await import('playwright');

    // Generate PKCE params
    const pkce = generatePkceParams();
    pkceCodeVerifier = pkce.codeVerifier;
    pkceState = pkce.state;

    const oauthUrl = buildClaudeOAuthUrl({
      codeChallenge: pkce.codeChallenge,
      state: pkce.state,
    });

    // Launch headless browser
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    page = await context.newPage();

    // Navigate to Claude OAuth page
    await page.goto(oauthUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    await dismissCookieBanner(page);

    // Enter email on the login page
    const emailInput = page.locator('input[type="email"], input[name="email"], input#email').first();
    const inputVisible = await emailInput.isVisible().catch(() => false);

    if (inputVisible) {
      await emailInput.fill(email);
      await page.waitForTimeout(500);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);
    } else {
      await closeBrowser();
      return { success: false, error: 'Could not find email input on Claude login page.' };
    }

    // Check if we're now on a "check your email" page (success)
    const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
    const onCheckEmail =
      bodyText.toLowerCase().includes('check your email') ||
      bodyText.toLowerCase().includes('magic link') ||
      bodyText.toLowerCase().includes('sent');

    if (onCheckEmail) {
      return { success: true };
    }

    // No positive signal found — treat as failure
    await closeBrowser();
    return { success: false, error: 'Failed to submit email. Check the email address and try again.' };
  } catch (err) {
    await closeBrowser();
    return { success: false, error: err instanceof Error ? err.message : 'Failed to start OAuth flow.' };
  }
}

// ---------------------------------------------------------------------------
// Step 2: Complete flow — navigate to magic link URL, capture token
// ---------------------------------------------------------------------------

export interface MagicLinkCompleteResult {
  success: boolean;
  token?: string;
  model?: string;
  error?: string;
}

export async function completeMagicLinkFlow(magicLinkUrl: string): Promise<MagicLinkCompleteResult> {
  if (!browser || !page) {
    return { success: false, error: 'No browser session active. Start the flow first.' };
  }

  if (!pkceCodeVerifier || !pkceState) {
    return { success: false, error: 'PKCE parameters missing. Start the flow first.' };
  }

  try {
    // Set up route interception BEFORE any navigation so fast redirects are captured
    let interceptedCallbackUrl: string | null = null;

    await page.route(`${OAUTH_CALLBACK_URI}**`, (route) => {
      interceptedCallbackUrl = route.request().url();
      route.fulfill({ status: 200, contentType: 'text/html', body: 'Token captured.' });
    });

    // Navigate to the magic link URL
    await page.goto(magicLinkUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    await dismissCookieBanner(page);

    let currentUrl = page.url();

    // Handle magic link verification page — click verify/continue button
    if (currentUrl.includes('/magic-link')) {
      const clicked = await page.evaluate(() => {
        const targets = ['Continue', 'Verify', 'Sign in', 'Log in', 'Confirm', 'Yes', 'Approve'];
        const buttons = Array.from(document.querySelectorAll('button, a'));
        for (const btn of buttons) {
          const text = btn.textContent?.trim() || '';
          for (const target of targets) {
            if (text.toLowerCase().includes(target.toLowerCase())) {
              (btn as HTMLElement).click();
              return text;
            }
          }
        }
        // Fallback: submit button
        const submit = document.querySelector('button[type="submit"]') as HTMLElement | null;
        if (submit) {
          submit.click();
          return submit.textContent?.trim();
        }
        return null;
      });

      if (clicked) {
        // Wait for navigation after button click
        await Promise.race([
          page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
          page.waitForTimeout(15000),
        ]);
      }

      currentUrl = page.url();
    }

    // Loop through authorize flow (org selection → authorize → callback)
    for (let step = 0; step < 5; step++) {
      if (interceptedCallbackUrl) break;

      currentUrl = page.url();

      if (!currentUrl.includes('/oauth/authorize')) {
        await page.waitForTimeout(3000);
        if (interceptedCallbackUrl) break;
        continue;
      }

      // Wait for React hydration
      await page.waitForTimeout(3000);
      await dismissCookieBanner(page);

      const pageText = await page.evaluate(() => document.body.innerText);

      // Handle org selection page
      if (pageText.includes('Select') && (pageText.includes('organization') || pageText.includes('Organisation'))) {
        await page.evaluate(() => {
          const clickTargets = Array.from(
            document.querySelectorAll('button, a, [role="button"], [role="option"], li, div[class*="item"]'),
          );
          for (const el of clickTargets) {
            const text = (el as HTMLElement).textContent?.trim() || '';
            if (
              text.length > 0 &&
              text.length < 100 &&
              !text.toLowerCase().includes('cookie') &&
              !text.toLowerCase().includes('reject') &&
              !text.toLowerCase().includes('accept') &&
              !text.toLowerCase().includes('select')
            ) {
              (el as HTMLElement).click();
              return;
            }
          }
        });

        await Promise.race([
          page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => {}),
          page.waitForTimeout(10000),
        ]);
        continue;
      }

      // Click Authorize button
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
        const authBtn = buttons.find(
          (b) => b.textContent?.trim() === 'Authorize' || b.textContent?.toLowerCase().includes('authorize'),
        );
        if (authBtn) (authBtn as HTMLElement).click();
      });

      await page.waitForTimeout(5000);
    }

    // Extract code from intercepted callback
    if (!interceptedCallbackUrl) {
      await closeBrowser();
      return { success: false, error: 'Authorization flow did not complete. Try again.' };
    }

    const url = new URL(interceptedCallbackUrl);
    const authCode = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');

    if (returnedState !== pkceState) {
      await closeBrowser();
      return { success: false, error: 'State mismatch — possible CSRF. Try again.' };
    }

    if (!authCode) {
      await closeBrowser();
      return { success: false, error: 'No authorization code in callback.' };
    }

    // Exchange code for token
    let tokenResult: ClaudeOAuthResult;
    try {
      tokenResult = await exchangeClaudeOAuthCode({
        code: authCode,
        codeVerifier: pkceCodeVerifier,
        state: pkceState,
      });
    } catch (err) {
      await closeBrowser();
      return { success: false, error: err instanceof Error ? err.message : 'Token exchange failed.' };
    }

    await closeBrowser();
    return { success: true, token: tokenResult.accessToken, model: 'Claude (OAuth)' };
  } catch (err) {
    await closeBrowser();
    return { success: false, error: err instanceof Error ? err.message : 'Failed to complete OAuth flow.' };
  }
}

/**
 * Cancel any in-progress flow and clean up.
 */
export async function cancelMagicLinkFlow(): Promise<void> {
  await closeBrowser();
}
