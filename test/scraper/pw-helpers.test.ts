import { describe, expect, it, vi } from 'vitest';

import {
  buildLaunchOptions,
  randomUserAgent,
  randomViewport,
  screenshotOnFailure,
  stealthDelay,
  waitForSelector,
} from '../../src/scraper/pw-helpers.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pw-helpers', () => {
  describe('randomUserAgent', () => {
    it('returns a non-empty string', () => {
      const ua = randomUserAgent();
      expect(typeof ua).toBe('string');
      expect(ua.length).toBeGreaterThan(0);
    });

    it('returns a valid browser user agent', () => {
      const ua = randomUserAgent();
      expect(ua).toMatch(/Mozilla|Safari|Firefox|Chrome/);
    });
  });

  describe('randomViewport', () => {
    it('returns width and height within default ranges', () => {
      const vp = randomViewport();
      expect(vp.width).toBeGreaterThanOrEqual(1280);
      expect(vp.width).toBeLessThanOrEqual(1440);
      expect(vp.height).toBeGreaterThanOrEqual(800);
      expect(vp.height).toBeLessThanOrEqual(900);
    });

    it('uses provided overrides', () => {
      const vp = randomViewport({ width: 1920, height: 1080 });
      expect(vp.width).toBe(1920);
      expect(vp.height).toBe(1080);
    });
  });

  describe('stealthDelay', () => {
    it('delays within default range', async () => {
      const start = Date.now();
      await stealthDelay({ minDelay: 10, maxDelay: 50 });
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(10);
      expect(elapsed).toBeLessThan(200); // generous upper bound
    });
  });

  describe('waitForSelector', () => {
    it('returns true when selector is found', async () => {
      const mockPage = {
        waitForSelector: vi.fn().mockResolvedValue({}),
      };

      const result = await waitForSelector(mockPage as never, '.my-element', {
        timeout: 1000,
        retries: 1,
      });
      expect(result).toBe(true);
      expect(mockPage.waitForSelector).toHaveBeenCalledWith('.my-element', {
        timeout: 1000,
        state: 'visible',
      });
    });

    it('returns false after all retries fail', async () => {
      const mockPage = {
        waitForSelector: vi.fn().mockRejectedValue(new Error('Timeout')),
      };

      const result = await waitForSelector(mockPage as never, '.missing', {
        timeout: 100,
        retries: 2,
      });
      expect(result).toBe(false);
      // 2 retries = 2 calls
      expect(mockPage.waitForSelector).toHaveBeenCalledTimes(2);
    });

    it('retries on failure before succeeding', async () => {
      const mockPage = {
        waitForSelector: vi.fn().mockRejectedValueOnce(new Error('Timeout')).mockResolvedValueOnce({}),
      };

      const result = await waitForSelector(mockPage as never, '.delayed', {
        timeout: 100,
        retries: 3,
      });
      expect(result).toBe(true);
      expect(mockPage.waitForSelector).toHaveBeenCalledTimes(2);
    });
  });

  describe('buildLaunchOptions', () => {
    it('returns headless:true by default', () => {
      const opts = buildLaunchOptions();
      expect(opts.headless).toBe(true);
    });

    it('respects headless override', () => {
      const opts = buildLaunchOptions({ headless: false });
      expect(opts.headless).toBe(false);
    });

    it('includes anti-detection args', () => {
      const opts = buildLaunchOptions();
      expect(opts.args).toContain('--disable-blink-features=AutomationControlled');
    });
  });

  describe('screenshotOnFailure', () => {
    it('injects PII mask before capture and removes it after', async () => {
      const evaluateCalls: string[] = [];
      const mockPage = {
        evaluate: vi.fn().mockImplementation((script: string) => {
          evaluateCalls.push(script);
          return Promise.resolve();
        }),
        screenshot: vi.fn().mockResolvedValue(Buffer.from('png')),
      };

      const tmpDir = `/tmp/yojin-test-screenshots-${Date.now()}`;
      const filepath = await screenshotOnFailure(mockPage as never, 'test', tmpDir);

      expect(filepath).toContain('test-');
      expect(filepath).toContain('.png');

      // First evaluate injects the mask
      expect(evaluateCalls[0]).toContain('__yojin_pii_mask');
      expect(evaluateCalls[0]).toContain('color: transparent');
      // Second evaluate removes the mask
      expect(evaluateCalls[1]).toContain('__yojin_pii_mask');
      expect(evaluateCalls[1]).toContain('remove');
      // Screenshot is called between the two evaluates
      expect(mockPage.screenshot).toHaveBeenCalledTimes(1);
    });
  });
});
