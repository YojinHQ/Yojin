/**
 * PriceHistoryProvider — historical OHLCV bars for backtesting.
 *
 * Wraps jintel-client's `priceHistory()` with a per-ticker JSONL disk cache
 * at $YOJIN_HOME/cache/price-history/<TICKER>.jsonl. Cache entries are bars
 * `{ date: YYYY-MM-DD, open, high, low, close, volume }` sorted ascending.
 *
 * A 90-day backtest across 20 tickers touches 1800 bars; fetching every run
 * would burn Jintel budget, so we cache aggressively. Cache invalidation is
 * out of scope — the upstream Jintel client caches fresh responses already;
 * the local cache is only for historical (immutable) bars.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { JintelClient } from '@yojinhq/jintel-client';

import type { PriceBar } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('backtest-price-history');

/** Supported Jintel ranges, largest→smallest. Used to pick the smallest that covers `since`. */
const JINTEL_RANGES: ReadonlyArray<{ label: string; days: number }> = [
  { label: '5d', days: 5 },
  { label: '1m', days: 31 },
  { label: '3m', days: 93 },
  { label: '6m', days: 186 },
  { label: '1y', days: 366 },
  { label: '2y', days: 732 },
  { label: '5y', days: 1830 },
  { label: 'max', days: Number.POSITIVE_INFINITY },
];

export interface PriceHistoryProviderOptions {
  client: JintelClient | null;
  cacheDir: string;
}

export class PriceHistoryProvider {
  private readonly client: JintelClient | null;
  private readonly cacheDir: string;
  private readonly memo = new Map<string, PriceBar[]>();

  constructor(options: PriceHistoryProviderOptions) {
    this.client = options.client;
    this.cacheDir = options.cacheDir;
  }

  /**
   * Return all bars for `ticker` covering [since, until] inclusive (YYYY-MM-DD strings).
   * Fetches from Jintel on cache miss and merges into disk cache.
   */
  async getBars(ticker: string, since: string, until: string): Promise<PriceBar[]> {
    const symbol = ticker.toUpperCase();
    const cached = await this.loadCache(symbol);
    if (this.rangeCovered(cached, since, until)) {
      return this.sliceRange(cached, since, until);
    }

    if (!this.client) {
      logger.warn('Price history cache miss and no Jintel client configured', { ticker: symbol, since, until });
      return this.sliceRange(cached, since, until);
    }

    const fetched = await this.fetchFromJintel(symbol, since);
    const merged = this.mergeBars(cached, fetched);
    await this.saveCache(symbol, merged);
    this.memo.set(symbol, merged);
    return this.sliceRange(merged, since, until);
  }

  /**
   * Close price at or before `date`. Walks backwards past weekends/holidays.
   * Returns null when no bar on-or-before `date` exists in the cached range.
   */
  async closeAt(ticker: string, date: string): Promise<number | null> {
    const bar = await this.barAtOrBefore(ticker, date);
    return bar?.close ?? null;
  }

  /** Percentage change in close from `lookbackDays` before `date` to `date`. */
  async pctChange(ticker: string, date: string, lookbackDays: number): Promise<number | null> {
    const end = await this.barAtOrBefore(ticker, date);
    if (!end) return null;
    const startDate = shiftDays(date, -lookbackDays);
    const start = await this.barAtOrBefore(ticker, startDate);
    if (!start || start.close === 0) return null;
    return ((end.close - start.close) / start.close) * 100;
  }

  /** Find the bar with the largest `date` that is ≤ the target date. */
  private async barAtOrBefore(ticker: string, date: string): Promise<PriceBar | null> {
    const symbol = ticker.toUpperCase();
    const bars = await this.ensureCoverage(symbol, date);
    if (bars.length === 0) return null;
    let lo = 0;
    let hi = bars.length - 1;
    let best: PriceBar | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (bars[mid].date <= date) {
        best = bars[mid];
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  }

  /**
   * Ensure the cache covers `date`. If the cache is empty or starts after `date`,
   * fetch from Jintel using the smallest range that reaches back far enough.
   */
  private async ensureCoverage(ticker: string, date: string): Promise<PriceBar[]> {
    const cached = await this.loadCache(ticker);
    if (cached.length > 0 && cached[0].date <= date) return cached;

    if (!this.client) return cached;

    const fetched = await this.fetchFromJintel(ticker, date);
    const merged = this.mergeBars(cached, fetched);
    await this.saveCache(ticker, merged);
    this.memo.set(ticker, merged);
    return merged;
  }

  private async fetchFromJintel(ticker: string, since: string): Promise<PriceBar[]> {
    if (!this.client) return [];
    const range = pickJintelRange(since);
    const result = await this.client.priceHistory([ticker], range, '1d');
    if (!result.success) {
      logger.warn('Jintel priceHistory failed', { ticker, range, error: result.error });
      return [];
    }
    const entry = result.data.find((e) => e.ticker.toUpperCase() === ticker.toUpperCase());
    if (!entry) return [];
    return entry.history.map((h) => ({
      date: h.date.slice(0, 10),
      open: h.open,
      high: h.high,
      low: h.low,
      close: h.close,
      volume: h.volume,
    }));
  }

  private rangeCovered(bars: PriceBar[], since: string, until: string): boolean {
    if (bars.length === 0) return false;
    return bars[0].date <= since && bars[bars.length - 1].date >= until;
  }

  private sliceRange(bars: PriceBar[], since: string, until: string): PriceBar[] {
    return bars.filter((b) => b.date >= since && b.date <= until);
  }

  private mergeBars(existing: PriceBar[], incoming: PriceBar[]): PriceBar[] {
    if (existing.length === 0) return [...incoming].sort((a, b) => a.date.localeCompare(b.date));
    const byDate = new Map<string, PriceBar>();
    for (const b of existing) byDate.set(b.date, b);
    for (const b of incoming) byDate.set(b.date, b); // fresh fetch wins on conflict
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  private async loadCache(ticker: string): Promise<PriceBar[]> {
    const memoed = this.memo.get(ticker);
    if (memoed) return memoed;

    const path = this.cacheFile(ticker);
    if (!existsSync(path)) {
      this.memo.set(ticker, []);
      return [];
    }
    const raw = await readFile(path, 'utf-8');
    const bars = raw
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as PriceBar);
    this.memo.set(ticker, bars);
    return bars;
  }

  private async saveCache(ticker: string, bars: PriceBar[]): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
    const path = this.cacheFile(ticker);
    const body = bars.map((b) => JSON.stringify(b)).join('\n') + '\n';
    await writeFile(path, body, 'utf-8');
  }

  private cacheFile(ticker: string): string {
    return join(this.cacheDir, `${ticker.toUpperCase()}.jsonl`);
  }
}

/** Smallest Jintel range whose lookback reaches `since`. */
export function pickJintelRange(since: string, today: Date = new Date()): string {
  const sinceMs = Date.parse(`${since}T00:00:00Z`);
  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = Math.ceil((todayMs - sinceMs) / 86_400_000);
  for (const entry of JINTEL_RANGES) {
    if (days <= entry.days) return entry.label;
  }
  return 'max';
}

function shiftDays(dateStr: string, deltaDays: number): string {
  const ms = Date.parse(`${dateStr}T00:00:00Z`) + deltaDays * 86_400_000;
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear().toString().padStart(4, '0');
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export { shiftDays };
