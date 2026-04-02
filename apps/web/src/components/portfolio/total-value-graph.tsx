import { useEffect, useRef, useMemo } from 'react';
import { createChart, AreaSeries, type IChartApi, type ISeriesApi, type Time, ColorType } from 'lightweight-charts';
import { CardEmptyState } from '../common/card-empty-state';
import type { PortfolioHistoryPoint } from '../../api/types';

interface TotalValueGraphProps {
  history: PortfolioHistoryPoint[];
}

/** Convert history points to chart-ready { date, value } using UTC dates, deduped by date (latest timestamp wins). */
function toChartData(history: PortfolioHistoryPoint[]): { date: string; value: number }[] {
  const byDate = new Map<string, { value: number; timestamp: string }>();
  for (const p of history) {
    const date = new Date(p.timestamp).toISOString().slice(0, 10);
    const existing = byDate.get(date);
    if (!existing || p.timestamp > existing.timestamp) {
      byDate.set(date, { value: p.totalValue, timestamp: p.timestamp });
    }
  }
  return Array.from(byDate, ([date, { value }]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
}

export function TotalValueGraph({ history }: TotalValueGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);
  const chartData = useMemo(() => toChartData(history), [history]);

  // Create chart once on mount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

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
      leftPriceScale: { visible: true, borderVisible: false },
      rightPriceScale: { visible: false },
      timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
      handleScroll: { vertTouchDrag: false },
    });

    chartRef.current = chart;

    seriesRef.current = chart.addSeries(AreaSeries, {
      priceScaleId: 'left',
      lineWidth: 2,
      crosshairMarkerRadius: 4,
      priceFormat: {
        type: 'custom',
        formatter: (p: number) => `$${p.toLocaleString('en-US', { minimumFractionDigits: 0 })}`,
      },
    });

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
      seriesRef.current = null;
    };
  }, []);

  // Update series data when chartData changes
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || chartData.length === 0) return;

    const isUp = chartData.length >= 2 && chartData[chartData.length - 1].value >= chartData[0].value;
    const lineColor = isUp ? '#5bb98c' : '#ff5a5e';

    series.applyOptions({
      lineColor,
      topColor: isUp ? 'rgba(91, 185, 140, 0.3)' : 'rgba(255, 90, 94, 0.3)',
      bottomColor: isUp ? 'rgba(91, 185, 140, 0)' : 'rgba(255, 90, 94, 0)',
    });

    series.setData(chartData.map((d) => ({ time: d.date as Time, value: d.value })));
    chart.timeScale().fitContent();
  }, [chartData]);

  if (chartData.length === 0) {
    return (
      <CardEmptyState
        icon={
          <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5m.75-9 3-3 2.148 2.148A12.061 12.061 0 0 1 16.5 7.605"
            />
          </svg>
        }
        title="No history available"
        description="Import portfolio snapshots to see value over time."
      />
    );
  }

  return <div ref={containerRef} className="h-full w-full" />;
}
