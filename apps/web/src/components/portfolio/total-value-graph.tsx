import { useEffect, useRef, useMemo } from 'react';
import { createChart, type IChartApi, type Time, ColorType } from 'lightweight-charts';
import { CardEmptyState } from '../common/card-empty-state';
import { getScaleDays, type TimeScale } from '../../lib/time-scales';
import type { PortfolioHistoryPoint } from '../../api/types';

interface TotalValueGraphProps {
  scale: TimeScale;
  history: PortfolioHistoryPoint[];
}

function ensureMinPoints(points: { date: string; value: number }[]): { date: string; value: number }[] {
  if (points.length >= 2) return points;
  if (points.length === 0) return [];
  const only = points[0];
  return [{ date: only.date, value: only.value }, only];
}

export function TotalValueGraph({ scale, history }: TotalValueGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const chartData = useMemo(() => {
    if (history.length === 0) return [];

    const days = getScaleDays(scale);
    const latest = new Date(history[history.length - 1].timestamp).getTime();
    const cutoff = latest - days * 24 * 60 * 60 * 1000;
    const filtered = history.filter((p) => new Date(p.timestamp).getTime() >= cutoff);

    const mapped = filtered.map((p) => {
      const ts = new Date(p.timestamp);
      const y = ts.getFullYear();
      const m = String(ts.getMonth() + 1).padStart(2, '0');
      const d = String(ts.getDate()).padStart(2, '0');
      return { date: `${y}-${m}-${d}`, value: p.totalValue };
    });

    return ensureMinPoints(mapped);
  }, [history, scale]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || chartData.length === 0) return;

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

    const isUp = chartData.length >= 2 && chartData[chartData.length - 1].value >= chartData[0].value;
    const lineColor = isUp ? '#5bb98c' : '#ff5a5e';

    const series = chart.addAreaSeries({
      lineColor,
      lineWidth: 2,
      topColor: isUp ? 'rgba(91, 185, 140, 0.3)' : 'rgba(255, 90, 94, 0.3)',
      bottomColor: isUp ? 'rgba(91, 185, 140, 0)' : 'rgba(255, 90, 94, 0)',
      crosshairMarkerRadius: 4,
      priceFormat: {
        type: 'custom',
        formatter: (p: number) => `$${p.toLocaleString('en-US', { minimumFractionDigits: 0 })}`,
      },
    });

    series.setData(
      chartData.map((d) => ({
        time: d.date as Time,
        value: d.value,
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
