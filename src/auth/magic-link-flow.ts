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

    // Navigate to Claude OAuth page — lands on claude.ai/login if not authenticated
    await page.goto(oauthUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    await dismissCookieBanner(page);

    // ── Phase 1: Reveal email input ──────────────────────────────────────────
    // Claude's login page shows SSO buttons first. Click any element that
    // looks like "Continue with email" / "Email" / "email address" to reveal
    // the email input field.
    const revealEmailInput = async (p: Page): Promise<boolean> => {
      return p.evaluate(() => {
        // Broad search: buttons, links, divs with role=button, and any clickable-looking element
        const clickables = Array.from(
          document.querySelectorAll('button, a, [role="button"], [role="link"], [tabindex="0"]'),
        );
        for (const el of clickables) {
          const text = (el as HTMLElement).textContent?.trim().toLowerCase() || '';
          const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() || '';
          const combined = `${text} ${ariaLabel}`;
          if (
            combined.includes('email') ||
            combined.includes('e-mail') ||
            combined.includes('log in with') ||
            combined.includes('sign in with')
          ) {
            (el as HTMLElement).click();
            return true;
          }
        }
        return false;
      });
    };

    // Try to reveal — then wait for potential transition/render
    const revealed = await revealEmailInput(page).catch(() => false);
    if (revealed) {
      await page.waitForTimeout(2000);
    }

    // ── Phase 2: Find and fill email input ───────────────────────────────────
    // Use waitForSelector to handle SPA rendering delays, then fall back to
    // scanning all visible inputs.
    const emailSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[name="email_address"]',
      'input[name="emailAddress"]',
      'input#email',
      'input[autocomplete="email"]',
      'input[autocomplete="username"]',
      'input[placeholder*="email" i]',
      'input[aria-label*="email" i]',
      'input[data-testid*="email" i]',
    ];

    let emailInput = null;

    // First try: wait for any email-specific input to appear (up to 5s)
    for (const selector of emailSelectors) {
      try {
        await page.waitForSelector(selector, { state: 'visible', timeout: 1000 });
        emailInput = page.locator(selector).first();
        break;
      } catch {
        // Not found with this selector, try next
      }
    }

    // Second try: any visible input that isn't hidden/checkbox/radio/submit
    if (!emailInput) {
      const fallbackInput = page
        .locator(
          'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"])',
        )
        .first();
      const fallbackVisible = await fallbackInput.isVisible().catch(() => false);
      if (fallbackVisible) {
        emailInput = fallbackInput;
      }
    }

    if (emailInput) {
      await emailInput.click();
      await emailInput.fill(email);
      await page.waitForTimeout(500);

      // Try clicking a submit/continue button first, fall back to Enter key
      const submitted = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button[type="submit"], button'));
        const submitBtn = buttons.find((b) => {
          const text = (b as HTMLElement).textContent?.toLowerCase() || '';
          return (
            text.includes('continue') ||
            text.includes('submit') ||
            text.includes('sign in') ||
            text.includes('log in') ||
            text.includes('send')
          );
        });
        if (submitBtn) {
          (submitBtn as HTMLElement).click();
          return true;
        }
        return false;
      });
      if (!submitted) {
        await page.keyboard.press('Enter');
      }
      await page.waitForTimeout(3000);
    } else {
      // Dump page structure for debugging
      const debugInfo = await page
        .evaluate(() => {
          const inputs = Array.from(document.querySelectorAll('input')).map((i) => ({
            type: i.type,
            name: i.name,
            id: i.id,
            placeholder: i.placeholder,
            visible: i.offsetParent !== null,
          }));
          const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).map((b) =>
            (b as HTMLElement).textContent?.trim().slice(0, 80),
          );
          return { inputs, buttons, url: window.location.href };
        })
        .catch(() => ({ inputs: [], buttons: [], url: 'unknown' }));

      await closeBrowser();
      return {
        success: false,
        error: `Could not find email input on the login page. Page elements: ${JSON.stringify(debugInfo)}`,
      };
    }

    // Check if we're now on a "check your email" / "verification sent" page (success)
    const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
    const lower = bodyText.toLowerCase();
    const onCheckEmail =
      lower.includes('check your email') ||
      lower.includes('magic link') ||
      lower.includes('verification') ||
      lower.includes('login link') ||
      lower.includes('sent a') ||
      lower.includes('sent you') ||
      lower.includes('inbox');

    if (onCheckEmail) {
      return { success: true };
    }

    // No positive signal — include page URL for debugging
    const finalUrl = page.url();
    await closeBrowser();
    return {
      success: false,
      error: `Email submitted but no confirmation detected (${finalUrl}). Check the email address and try again.`,
    };
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
