import { useEffect, useRef, useMemo } from 'react';
import { createChart, type IChartApi, type Time, ColorType } from 'lightweight-charts';
import type { PortfolioHistoryPoint } from '../../api/types';

interface PerformanceOvertimeProps {
  history: PortfolioHistoryPoint[];
}

/** Convert history points to chart-ready { date, pnl } with YYYY-MM-DD keys. */
function toChartData(history: PortfolioHistoryPoint[]): { date: string; pnl: number }[] {
  return history.map((h) => {
    const ts = new Date(h.timestamp);
    const y = ts.getFullYear();
    const m = String(ts.getMonth() + 1).padStart(2, '0');
    const d = String(ts.getDate()).padStart(2, '0');
    return { date: `${y}-${m}-${d}`, pnl: h.totalPnl };
  });
}

export function PerformanceOvertime({ history }: PerformanceOvertimeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const data = useMemo(() => toChartData(history), [history]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || data.length === 0) return;

    const { width, height } = container.getBoundingClientRect();
    if (width === 0 || height === 0) return;

    const chart = createChart(container, {
      width,
      height,
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
        const { width: w, height: h } = entry.contentRect;
        if (w > 0 && h > 0) chart.applyOptions({ width: w, height: h });
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
