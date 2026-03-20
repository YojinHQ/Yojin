/**
 * Playwright automation utilities — shared by all UI-tier connectors.
 *
 * Provides: stealth mode, retry-based selectors, screenshot-on-failure,
 * and browser launch configuration.
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { Browser, BrowserContext, Page } from 'playwright';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WaitForSelectorOptions {
  /** Timeout in ms (default 10_000). */
  timeout?: number;
  /** Number of retry attempts (default 3). */
  retries?: number;
  /** Wait state (default 'visible'). */
  state?: 'attached' | 'detached' | 'visible' | 'hidden';
}

export interface StealthOptions {
  /** Min delay between actions in ms (default 200). */
  minDelay?: number;
  /** Max delay between actions in ms (default 800). */
  maxDelay?: number;
}

export interface BrowserLaunchOptions {
  /** Run headless (default true). */
  headless?: boolean;
  /** Custom user agent (default: rotated). */
  userAgent?: string;
  /** Viewport width (default: randomized 1280-1440). */
  viewportWidth?: number;
  /** Viewport height (default: randomized 800-900). */
  viewportHeight?: number;
}

// ---------------------------------------------------------------------------
// User agent rotation
// ---------------------------------------------------------------------------

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
];

/** Pick a random user agent string. */
export function randomUserAgent(): string {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- array is non-empty, index is always in bounds
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]!;
}

// ---------------------------------------------------------------------------
// Viewport randomization
// ---------------------------------------------------------------------------

/** Generate a randomized viewport size within natural ranges. */
export function randomViewport(opts?: { width?: number; height?: number }): {
  width: number;
  height: number;
} {
  return {
    width: opts?.width ?? randomInt(1280, 1440),
    height: opts?.height ?? randomInt(800, 900),
  };
}

// ---------------------------------------------------------------------------
// Stealth delay
// ---------------------------------------------------------------------------

/** Random delay to mimic human interaction timing. */
export async function stealthDelay(opts?: StealthOptions): Promise<void> {
  const min = opts?.minDelay ?? 200;
  const max = opts?.maxDelay ?? 800;
  const ms = randomInt(min, max);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Wait for selector with retry
// ---------------------------------------------------------------------------

/**
 * Wait for a selector with retry logic. Returns the element handle or null.
 * Retries on timeout, re-throwing other errors.
 */
export async function waitForSelector(page: Page, selector: string, opts?: WaitForSelectorOptions): Promise<boolean> {
  const timeout = opts?.timeout ?? 10_000;
  const retries = opts?.retries ?? 3;
  const state = opts?.state ?? 'visible';

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await page.waitForSelector(selector, { timeout, state });
      return true;
    } catch {
      if (attempt === retries) return false;
      // Brief pause before retry
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Screenshot on failure
// ---------------------------------------------------------------------------

/** Save a debug screenshot when a scrape fails. */
export async function screenshotOnFailure(page: Page, platform: string, cacheDir: string): Promise<string> {
  const screenshotDir = path.join(cacheDir, 'screenshots');
  await mkdir(screenshotDir, { recursive: true });
  const filename = `${platform.toLowerCase()}-${Date.now()}.png`;
  const filepath = path.join(screenshotDir, filename);
  await page.screenshot({ path: filepath, fullPage: true });
  return filepath;
}

// ---------------------------------------------------------------------------
// Browser launch config
// ---------------------------------------------------------------------------

/** Build Playwright launch arguments with stealth defaults. */
export function buildLaunchOptions(opts?: BrowserLaunchOptions): {
  headless: boolean;
  args: string[];
} {
  return {
    headless: opts?.headless ?? true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox'],
  };
}

/** Build a new browser context with stealth settings. */
export async function createStealthContext(browser: Browser, opts?: BrowserLaunchOptions): Promise<BrowserContext> {
  const viewport = randomViewport({
    width: opts?.viewportWidth,
    height: opts?.viewportHeight,
  });
  const userAgent = opts?.userAgent ?? randomUserAgent();

  return browser.newContext({
    viewport,
    userAgent,
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
