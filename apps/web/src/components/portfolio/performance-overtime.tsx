import { useEffect, useRef, useMemo } from 'react';
import { createChart, HistogramSeries, type IChartApi, type Time, ColorType } from 'lightweight-charts';
import type { PortfolioHistoryPoint } from '../../api/types';

interface PerformanceOvertimeProps {
  history: PortfolioHistoryPoint[];
}

/** Convert history points to chart-ready { date, pnl } using UTC dates from the backend history ordering. */
/** Deduplicates by date (keeps last entry per day) because the backend returns
 *  multiple intraday snapshots and lightweight-charts requires unique time values. */
function toChartData(history: PortfolioHistoryPoint[]): { date: string; pnl: number }[] {
  const byDate = new Map<string, number>();
  for (const h of history) {
    byDate.set(new Date(h.timestamp).toISOString().slice(0, 10), h.periodPnl);
  }
  return Array.from(byDate, ([date, pnl]) => ({ date, pnl }));
}

export function PerformanceOvertime({ history }: PerformanceOvertimeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const data = useMemo(() => toChartData(history), [history]);

  // Create chart + apply data in same ResizeObserver callback to avoid race condition.
  // When data changes the effect re-runs: tears down old chart, observer recreates with fresh data.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || data.length === 0) return;

    let chart: IChartApi | null = null;

    const observer = new ResizeObserver((entries) => {
      const { width: w, height: h } = entries[0].contentRect;
      if (w === 0 || h === 0) return;

      if (!chart) {
        chart = createChart(container, {
          width: w,
          height: h,
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
          leftPriceScale: { visible: true, borderVisible: false },
          rightPriceScale: { visible: false },
          timeScale: {
            borderVisible: false,
            fixLeftEdge: true,
            fixRightEdge: true,
          },
          handleScroll: { vertTouchDrag: false },
        });

        const series = chart.addSeries(HistogramSeries, {
          priceScaleId: 'left',
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
      } else {
        chart.applyOptions({ width: w, height: h });
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart?.remove();
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
