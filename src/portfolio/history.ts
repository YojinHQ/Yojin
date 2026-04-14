import type { TickerPriceHistory } from '@yojinhq/jintel-client';

import type { PortfolioHistoryPoint, Position } from '../api/graphql/types.js';

/** Map Jintel price history to symbol → date → close price. */
export function buildPriceMap(data: TickerPriceHistory[]): Map<string, Map<string, number>> {
  const map = new Map<string, Map<string, number>>();
  for (const ticker of data) {
    const dateMap = new Map<string, number>();
    for (const point of ticker.history) {
      const day = point.date.slice(0, 10);
      dateMap.set(day, point.close);
    }
    map.set(ticker.ticker, dateMap);
  }
  return map;
}

function dateRange(start: string, end: string): string[] {
  const days: string[] = [];
  const d = new Date(start + 'T00:00:00Z');
  const endMs = new Date(end + 'T00:00:00Z').getTime();
  while (d.getTime() <= endMs) {
    days.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

export function fillCalendarDays(
  priceMap: Map<string, Map<string, number>>,
  start: string,
  end: string,
): Map<string, Map<string, number>> {
  const days = dateRange(start, end);
  const filled = new Map<string, Map<string, number>>();

  for (const [symbol, dateClose] of priceMap) {
    const filledDates = new Map<string, number>();
    let lastClose: number | undefined;

    for (const day of days) {
      const price = dateClose.get(day);
      if (price != null) {
        lastClose = price;
        filledDates.set(day, price);
      } else if (lastClose != null) {
        filledDates.set(day, lastClose);
      }
    }

    filled.set(symbol, filledDates);
  }

  return filled;
}

export interface HistoryBaseline {
  totalValue: number;
  totalCost: number;
}

export function buildHistoryPoints(
  positions: Position[],
  filledPrices: Map<string, Map<string, number>>,
  startDates: Map<string, string>,
  start: string,
  end: string,
  baseline: HistoryBaseline,
): PortfolioHistoryPoint[] {
  const days = dateRange(start, end);
  const points: PortfolioHistoryPoint[] = [];

  for (const day of days) {
    let totalValue = 0;
    let totalCost = 0;
    let hasAnyPosition = false;

    for (const pos of positions) {
      const key = `${pos.symbol}:${pos.platform}`;
      const posStart = startDates.get(key) ?? pos.entryDate ?? start;
      if (day < posStart) continue;

      const close = filledPrices.get(pos.symbol)?.get(day);
      if (close == null) continue;
      totalValue += pos.quantity * close;
      totalCost += pos.costBasis * pos.quantity;
      hasAnyPosition = true;
    }

    // Skip days before any position existed — the portfolio wasn't tracked yet.
    if (!hasAnyPosition) continue;

    const totalPnl = totalValue - totalCost;
    const totalPnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

    // Cumulative P&L since first-import baseline. Subtracting the cost delta
    // neutralizes positions added after import so they don't show as gains/losses.
    const periodPnl = totalValue - baseline.totalValue - (totalCost - baseline.totalCost);
    const periodPnlPercent = baseline.totalValue > 0 ? (periodPnl / baseline.totalValue) * 100 : 0;

    points.push({
      timestamp: `${day}T16:00:00Z`,
      totalValue,
      totalCost,
      totalPnl,
      totalPnlPercent,
      periodPnl,
      periodPnlPercent,
    });
  }

  return points;
}

export function resolvePositionStartDates(
  positions: Position[],
  timeline: Map<string, string> | null,
  fallbackDate?: string,
): Map<string, string> {
  const fallback = fallbackDate ?? new Date().toISOString().slice(0, 10);
  const result = new Map<string, string>();

  for (const pos of positions) {
    const key = `${pos.symbol}:${pos.platform}`;
    const startDate = pos.entryDate ?? timeline?.get(pos.symbol) ?? fallback;
    result.set(key, startDate);
  }

  return result;
}

export function daysToJintelRange(days?: number | null): string {
  if (days == null || days <= 7) return '1m';
  if (days <= 30) return '3m';
  if (days <= 90) return '6m';
  if (days <= 180) return '1y';
  return '2y';
}
