/**
 * Backtest indicators — minimal OHLCV-derived technicals for historical replay.
 *
 * Jintel's technicals sub-graph is live-only; for backtests we recompute a
 * small set (RSI14, SMA20, SMA50, SMA200) from cached bars. This is the subset
 * most strategies reference via `ctx.indicators[ticker].RSI` / `.SMA20` etc.
 */
import type { PriceBar } from './types.js';

export function computeIndicators(bars: PriceBar[], asOf: string): Record<string, number> {
  const upTo = bars.filter((b) => b.date <= asOf);
  if (upTo.length === 0) return {};

  const closes = upTo.map((b) => b.close);
  const result: Record<string, number> = {};

  const rsi = computeRsi(closes, 14);
  if (rsi !== null) result.RSI = rsi;

  const sma20 = sma(closes, 20);
  if (sma20 !== null) result.SMA20 = sma20;

  const sma50 = sma(closes, 50);
  if (sma50 !== null) result.SMA50 = sma50;

  const sma200 = sma(closes, 200);
  if (sma200 !== null) result.SMA200 = sma200;

  return result;
}

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/** Wilder-smoothed RSI. */
function computeRsi(closes: number[], period: number): number | null {
  if (closes.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
