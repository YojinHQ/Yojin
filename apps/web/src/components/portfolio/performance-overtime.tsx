import { useEffect, useRef, useMemo } from 'react';
import { createChart, type IChartApi, type Time, ColorType } from 'lightweight-charts';
import { getScaleDays, type TimeScale } from '../../lib/time-scales';
import type { PortfolioHistoryPoint } from '../../api/types';

interface PnlDataPoint {
  date: string;
  pnl: number;
}

interface PerformanceOvertimeProps {
  scale: TimeScale;
  history: PortfolioHistoryPoint[];
}

/** Local-timezone date key (YYYY-MM-DD). */
function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Derive daily P&L from portfolio history snapshots.
 */
function derivePnlFromHistory(history: PortfolioHistoryPoint[], scale: TimeScale): PnlDataPoint[] {
  if (history.length < 2) return [];

  const days = getScaleDays(scale);
  const latestTs = new Date(history[history.length - 1].timestamp);
  const cutoff = new Date(latestTs.getTime() - days * 24 * 60 * 60 * 1000);

  const valueByDay = new Map<string, number>();
  for (const h of history) {
    const day = toLocalDateKey(new Date(h.timestamp));
    valueByDay.set(day, h.totalValue);
  }

  const points: PnlDataPoint[] = [];
  const cursor = new Date(cutoff);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(latestTs);
  end.setHours(23, 59, 59, 999);

  let prevValue: number | undefined;

  for (const h of history) {
    const t = new Date(h.timestamp);
    if (t <= cutoff) {
      prevValue = h.totalValue;
    }
  }

  while (cursor <= end) {
    const dayKey = toLocalDateKey(cursor);
    const value = valueByDay.get(dayKey);

    if (value !== undefined) {
      const pnl = prevValue !== undefined ? Math.round((value - prevValue) * 100) / 100 : 0;
      points.push({ date: dayKey, pnl });
      prevValue = value;
    } else if (prevValue !== undefined) {
      points.push({ date: dayKey, pnl: 0 });
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return points;
}

export function PerformanceOvertime({ scale, history }: PerformanceOvertimeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const data = useMemo(() => derivePnlFromHistory(history, scale), [history, scale]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || data.length === 0) return;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#737373',
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
        fontSize: 10,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: '#3d3d3d', style: 4 },
      },
      crosshair: {
        vertLine: { color: '#737373', labelBackgroundColor: '#737373' },
        horzLine: { color: '#737373', labelBackgroundColor: '#737373' },
      },
      rightPriceScale: {
        borderVisible: false,
      },
      timeScale: {
        borderVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      handleScroll: { vertTouchDrag: false },
    });

    chartRef.current = chart;

    const series = chart.addHistogramSeries({
      priceFormat: {
        type: 'custom',
        formatter: (p: number) => {
          const sign = p >= 0 ? '+' : '-';
          return `${sign}$${Math.abs(p).toLocaleString('en-US')}`;
        },
      },
    });

    series.setData(
      data.map((d) => ({
        time: d.date as Time,
        value: d.pnl,
        color: d.pnl >= 0 ? 'rgba(91, 185, 140, 0.85)' : 'rgba(255, 90, 94, 0.85)',
      })),
    );

    chart.timeScale().fitContent();

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        chart.applyOptions({ width, height });
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [data]);

  if (data.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <p className="text-2xs text-text-muted/60">No P&L data yet</p>
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full" />;
}
