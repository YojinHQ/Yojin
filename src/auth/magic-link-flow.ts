/**
 * Claude OAuth magic-link flow using Playwright.
 *
 * Two-step process:
 *   1. startMagicLinkFlow(email)  — launch browser, navigate to Claude OAuth page, enter email
 *   2. completeMagicLinkFlow(url) — navigate to magic link URL, click Authorize, capture token
 *
 * Uses headed mode (visible browser) to bypass Cloudflare Turnstile bot protection
 * on claude.ai. This is acceptable because Yojin runs as a desktop app.
 */

import type { Browser, BrowserContext, Page } from 'playwright';

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
let _browserContext: BrowserContext | null = null;
let page: Page | null = null;
let pkceCodeVerifier = '';
let pkceState = '';
let flowInProgress = false;

const OAUTH_CALLBACK_URI = 'https://platform.claude.com/oauth/code/callback';
const OAUTH_SUCCESS_URI = 'https://platform.claude.com/oauth/code/success';

// Chrome user-agent — keep current to avoid Cloudflare flagging outdated browsers
const CHROME_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

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
  _browserContext = null;
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

/**
 * Launch a Playwright browser with anti-detection measures.
 * Uses headed mode to bypass Cloudflare Turnstile — Yojin is a desktop app,
 * so a visible browser window during onboarding is acceptable.
 */
async function launchStealthBrowser(): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  let chromium: typeof import('playwright').chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error(
      'This flow requires Playwright. Install it with `npm install playwright` and then `npx playwright install chromium`.',
    );
  }

  const b = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-infobars',
      '--window-size=1280,800',
    ],
  });

  const ctx = await b.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: CHROME_USER_AGENT,
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  // Stealth: remove navigator.webdriver flag that Cloudflare checks
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    // Fake chrome.runtime to look like a real Chrome installation
    if (!(window as unknown as Record<string, unknown>).chrome) {
      (window as unknown as Record<string, unknown>).chrome = {
        runtime: {},
        loadTimes: () => ({}),
        csi: () => ({}),
      };
    }
    // Override permissions query to prevent detection
    const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
    window.navigator.permissions.query = (params: PermissionDescriptor) => {
      if (params.name === 'notifications') {
        return Promise.resolve({ state: 'denied', onchange: null } as PermissionStatus);
      }
      return originalQuery(params);
    };
  });

  const p = await ctx.newPage();
  return { browser: b, context: ctx, page: p };
}

/**
 * Wait for Cloudflare Turnstile challenge to resolve and the real page content to load.
 * Returns true if the page appears ready, false if it's still stuck on Turnstile.
 */
async function waitForTurnstile(p: Page, timeoutMs = 30000): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const hasRealContent = await p.evaluate(() => {
      // Check if there are visible inputs (beyond the hidden turnstile one)
      const visibleInputs = Array.from(document.querySelectorAll('input')).filter(
        (i) => i.type !== 'hidden' && i.offsetParent !== null,
      );
      // Check if there are visible buttons
      const visibleButtons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(
        (b) => (b as HTMLElement).offsetParent !== null,
      );
      // Check for any interactive clickable elements (SSO buttons, links)
      const clickables = Array.from(document.querySelectorAll('a, [tabindex="0"]')).filter(
        (el) => (el as HTMLElement).offsetParent !== null && (el as HTMLElement).textContent?.trim(),
      );
      return visibleInputs.length > 0 || visibleButtons.length > 0 || clickables.length > 2;
    });

    if (hasRealContent) return true;

    await p.waitForTimeout(1000);
  }

  return false;
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
    // Generate PKCE params
    const pkce = generatePkceParams();
    pkceCodeVerifier = pkce.codeVerifier;
    pkceState = pkce.state;

    const oauthUrl = buildClaudeOAuthUrl({
      codeChallenge: pkce.codeChallenge,
      state: pkce.state,
    });

    // Launch browser with anti-detection
    const launched = await launchStealthBrowser();
    browser = launched.browser;
    _browserContext = launched.context;
    page = launched.page;

    // Navigate to Claude OAuth page — lands on claude.ai/login if not authenticated
    await page.goto(oauthUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for Cloudflare Turnstile to resolve and page to render
    const pageReady = await waitForTurnstile(page, 30000);

    if (!pageReady) {
      // Page didn't render — Cloudflare likely blocked us
      const debugInfo = await page
        .evaluate(() => ({
          inputs: Array.from(document.querySelectorAll('input')).map((i) => ({
            type: i.type,
            name: i.name,
            id: i.id,
            visible: i.offsetParent !== null,
          })),
          buttons: Array.from(document.querySelectorAll('button, [role="button"]')).map((b) =>
            (b as HTMLElement).textContent?.trim().slice(0, 80),
          ),
          url: window.location.href,
        }))
        .catch(() => ({ inputs: [], buttons: [], url: 'unknown' }));

      console.error('[magic-link] Cloudflare block debug:', debugInfo);
      await closeBrowser();
      return {
        success: false,
        error: `Claude's login page didn't load (Cloudflare protection). Try "Open in browser" instead.`,
      };
    }

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
        await page.waitForSelector(selector, { state: 'visible', timeout: 1500 });
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
      // Clear any existing value and type with delay (more reliable than fill for SPAs)
      await emailInput.click({ clickCount: 3 });
      await emailInput.pressSequentially(email, { delay: 30 });
      await page.waitForTimeout(1000);

      // Try clicking a submit/continue button first, fall back to Enter key.
      // Skip SSO buttons (Google, GitHub, etc.) — always prefer email login.
      const submitted = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button[type="submit"], button'));
        const ssoKeywords = ['google', 'github', 'apple', 'microsoft', 'sso', 'saml'];

        // Priority 1: "Continue with email"
        const emailBtn = buttons.find((b) => {
          const text = (b as HTMLElement).textContent?.toLowerCase() || '';
          return text.includes('email') && text.includes('continue');
        });
        if (emailBtn) {
          (emailBtn as HTMLElement).click();
          return true;
        }

        // Priority 2: Other submit buttons, skipping SSO
        const submitBtn = buttons.find((b) => {
          const text = (b as HTMLElement).textContent?.toLowerCase() || '';
          if (ssoKeywords.some((sso) => text.includes(sso))) return false;
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

      console.error('[magic-link] Email input not found debug:', debugInfo);
      await closeBrowser();
      return {
        success: false,
        error: `Could not find email input on the login page. Try "Open in browser" instead.`,
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

    // No positive signal — but keep browser open for completeMagicLinkFlow.
    // The email may still have been sent even if we didn't detect the confirmation text.
    const finalUrl = page.url();
    return {
      success: true,
      error: `Email submitted but no confirmation detected (${finalUrl}). Check your inbox anyway.`,
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
  refreshToken?: string;
  model?: string;
  error?: string;
}

export async function completeMagicLinkFlow(magicLinkUrl: string): Promise<MagicLinkCompleteResult> {
  // Same browser must be reused from startMagicLinkFlow — magic links are single-use
  // and the PKCE session is tied to this browser instance.
  if (!browser || !page) {
    await closeBrowser();
    return { success: false, error: 'No browser session. Please enter your email and send a new magic link.' };
  }

  if (page.isClosed()) {
    await closeBrowser();
    return { success: false, error: 'Browser window was closed. Please enter your email and send a new magic link.' };
  }

  if (!pkceCodeVerifier || !pkceState) {
    await closeBrowser();
    return { success: false, error: 'PKCE session expired. Please enter your email and send a new magic link.' };
  }

  const p = page;

  try {
    // Set up route interception BEFORE any navigation so fast redirects are captured.
    // Claude may redirect to either /oauth/code/callback?code=X or /oauth/code/success?app=claude-code
    let interceptedCallbackUrl: string | null = null;

    await p.route(`${OAUTH_CALLBACK_URI}**`, (route) => {
      interceptedCallbackUrl = route.request().url();
      route.fulfill({ status: 200, contentType: 'text/html', body: 'Token captured.' });
    });

    // Also intercept the success page (newer Claude flow)
    await p.route(`${OAUTH_SUCCESS_URI}**`, (route) => {
      interceptedCallbackUrl = route.request().url();
      // Let this one through so we can scrape the code from the page if needed
      route.continue();
    });

    // Navigate to the magic link URL — this authenticates the user on claude.ai
    await p.goto(magicLinkUrl, { waitUntil: 'networkidle' });

    // Wait for Turnstile to resolve on the magic link page too
    const linkPageReady = await waitForTurnstile(p, 15000);
    if (!linkPageReady) {
      await closeBrowser();
      return { success: false, error: `Magic link page didn't load (Cloudflare protection). Please try again.` };
    }

    await dismissCookieBanner(p);

    let currentUrl = p.url();

    // Handle magic link verification page OR login page — click through any
    // "Continue with email", "Verify", "Sign in", etc. buttons.
    // The magic link URL can land on /magic-link, /login, or other intermediate pages.
    if (!currentUrl.includes('/oauth/authorize')) {
      // Click through up to 3 intermediate pages (login → verify → authorize)
      for (let clickStep = 0; clickStep < 3; clickStep++) {
        if (interceptedCallbackUrl) break;
        currentUrl = p.url();
        if (currentUrl.includes('/oauth/authorize')) break;

        const clicked = await p.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
          // SSO providers to skip — we always want email-based login
          const ssoKeywords = ['google', 'github', 'apple', 'microsoft', 'sso', 'saml'];

          // Priority 1: "Continue with email" — exact match
          for (const btn of buttons) {
            const text = (btn as HTMLElement).textContent?.trim().toLowerCase() || '';
            if (text.includes('email') && text.includes('continue')) {
              (btn as HTMLElement).click();
              (btn as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
              return (btn as HTMLElement).textContent?.trim() ?? null;
            }
          }

          // Priority 2: Other action buttons — skip anything with SSO keywords
          const targets = ['verify', 'sign in', 'log in', 'confirm', 'approve', 'continue'];
          for (const btn of buttons) {
            const text = (btn as HTMLElement).textContent?.trim().toLowerCase() || '';
            if (ssoKeywords.some((sso) => text.includes(sso))) continue;
            for (const target of targets) {
              if (text.includes(target)) {
                (btn as HTMLElement).click();
                (btn as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                return (btn as HTMLElement).textContent?.trim() ?? null;
              }
            }
          }

          // Fallback: submit button
          const submit = document.querySelector('button[type="submit"]') as HTMLElement | null;
          if (submit) {
            submit.click();
            return submit.textContent?.trim() ?? null;
          }
          return null;
        });

        if (!clicked) break;

        // Wait for navigation after button click
        await Promise.race([
          p.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
          p.waitForTimeout(15000),
        ]);
      }

      currentUrl = p.url();
    }

    // Loop through authorize flow (org selection → authorize → callback)
    for (let step = 0; step < 5; step++) {
      if (interceptedCallbackUrl) break;

      currentUrl = p.url();

      if (!currentUrl.includes('/oauth/authorize')) {
        await p.waitForTimeout(3000);
        if (interceptedCallbackUrl) break;
        continue;
      }

      // Wait for React hydration
      await p.waitForTimeout(3000);
      await dismissCookieBanner(p);

      const pageText = await p.evaluate(() => document.body.innerText);

      // Handle org selection page
      if (pageText.includes('Select') && (pageText.includes('organization') || pageText.includes('Organisation'))) {
        const lowerPageText = pageText.toLowerCase();
        const hasSubscription =
          lowerPageText.includes('subscription') ||
          lowerPageText.includes('max plan') ||
          lowerPageText.includes('pro plan');

        await p.evaluate((preferSubscriptionLogin: boolean) => {
          // Priority 1: For subscription users, click the subscription/chat account login link
          if (preferSubscriptionLogin) {
            const links = Array.from(document.querySelectorAll('a, button'));
            const subLink = links.find((el) => {
              const text = el.textContent?.toLowerCase() || '';
              return text.includes('subscription') || text.includes('chat account') || text.includes('login with your');
            });
            if (subLink && subLink instanceof HTMLElement) {
              subLink.click();
              subLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
              return;
            }
          }

          // Priority 2: Click an organization name
          const clickTargets = Array.from(
            document.querySelectorAll(
              'button, a, [role="button"], [role="option"], li, div[class*="item"], div[class*="option"]',
            ),
          );
          for (const el of clickTargets) {
            const text = (el as HTMLElement).textContent?.trim() || '';
            if (
              text.length > 0 &&
              text.length < 100 &&
              !text.toLowerCase().includes('cookie') &&
              !text.toLowerCase().includes('reject') &&
              !text.toLowerCase().includes('accept') &&
              !text.toLowerCase().includes('customize') &&
              !text.toLowerCase().includes('select') &&
              !text.toLowerCase().includes('login with') &&
              !text.toLowerCase().includes('check your email') &&
              !text.toLowerCase().includes("can't find") &&
              !text.toLowerCase().includes('max plan')
            ) {
              (el as HTMLElement).click();
              (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
              return;
            }
          }
        }, hasSubscription);

        await Promise.race([
          p.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => {}),
          p.waitForTimeout(10000),
        ]);
        continue;
      }

      // Click Authorize button — try multiple methods for reliability
      let clicked = false;

      // Method 1: Playwright text locator
      try {
        const authLocator = p.getByRole('button', { name: 'Authorize' });
        if (await authLocator.isVisible({ timeout: 3000 }).catch(() => false)) {
          await authLocator.click();
          clicked = true;
        }
      } catch {
        // fall through to next method
      }

      // Method 2: DOM tree walk + MouseEvent dispatch (most reliable for React apps)
      if (!clicked) {
        clicked = await p.evaluate(() => {
          // Tree walker for exact text match
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node: Node | null;
          while ((node = walker.nextNode())) {
            if (node.textContent?.trim() === 'Authorize') {
              const el = node.parentElement;
              if (el) {
                el.click();
                el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                return true;
              }
            }
          }
          // Fallback: query selector
          const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
          const authBtn = buttons.find(
            (b) => b.textContent?.trim() === 'Authorize' || b.textContent?.toLowerCase().includes('authorize'),
          );
          if (authBtn && authBtn instanceof HTMLElement) {
            authBtn.click();
            authBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            return true;
          }
          return false;
        });
      }

      await p.waitForTimeout(5000);
    }

    // Extract code from intercepted callback or success page
    if (!interceptedCallbackUrl) {
      // Last resort: check if the page navigated to a success/callback URL we missed
      const finalUrl = p.url();
      if (finalUrl.includes('code=') || finalUrl.includes('/oauth/code/')) {
        interceptedCallbackUrl = finalUrl;
      }
    }

    if (!interceptedCallbackUrl) {
      // Try to scrape the code from the current page (newer flow shows code on-screen)
      const scrapedCode = await p
        .evaluate(() => {
          // Look for the code in common display patterns
          const codeEl = document.querySelector('code, pre, [data-testid*="code"]');
          if (codeEl?.textContent?.trim()) return codeEl.textContent.trim();
          // Look for "Paste this into Claude Code" pattern
          const allText = document.body.innerText;
          const codeMatch = allText.match(/[A-Za-z0-9_-]{30,}/);
          return codeMatch?.[0] ?? null;
        })
        .catch(() => null);

      if (scrapedCode) {
        // Exchange scraped code for token
        let tokenResult: ClaudeOAuthResult;
        try {
          tokenResult = await exchangeClaudeOAuthCode({
            code: scrapedCode,
            codeVerifier: pkceCodeVerifier,
            state: pkceState,
          });
        } catch (err) {
          await closeBrowser();
          return { success: false, error: err instanceof Error ? err.message : 'Token exchange failed.' };
        }
        await closeBrowser();
        return {
          success: true,
          token: tokenResult.accessToken,
          refreshToken: tokenResult.refreshToken,
          model: 'Claude (OAuth)',
        };
      }

      await closeBrowser();
      return { success: false, error: 'Authorization flow did not complete. Try again.' };
    }

    const url = new URL(interceptedCallbackUrl);
    let authCode = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');

    // For success page URLs, state won't be in the URL — skip state check
    if (returnedState && returnedState !== pkceState) {
      await closeBrowser();
      return { success: false, error: 'State mismatch — possible CSRF. Try again.' };
    }

    if (!authCode) {
      // Success page: code might be displayed on the page, not in URL
      await p.waitForTimeout(2000);
      authCode = await p
        .evaluate(() => {
          const codeEl = document.querySelector('code, pre, [data-testid*="code"]');
          if (codeEl?.textContent?.trim()) return codeEl.textContent.trim();
          const allText = document.body.innerText;
          const codeMatch = allText.match(/[A-Za-z0-9_-]{30,}/);
          return codeMatch?.[0] ?? null;
        })
        .catch(() => null);
    }

    if (!authCode) {
      await closeBrowser();
      return { success: false, error: 'No authorization code found. Try again.' };
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
    return {
      success: true,
      token: tokenResult.accessToken,
      refreshToken: tokenResult.refreshToken,
      model: 'Claude (OAuth)',
    };
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
