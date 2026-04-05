import { useEffect, useRef } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type CandlestickData,
  type Time,
  type UTCTimestamp,
  ColorType,
} from 'lightweight-charts';

export interface PriceChartDatum {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface PriceChartProps {
  data: PriceChartDatum[];
  /** When true, preserves intraday timestamps and shows time on the axis. */
  intraday?: boolean;
}

const COLORS = {
  bg: 'transparent',
  text: '#737373',
  border: '#3d3d3d',
  up: '#5bb98c',
  upWick: '#5bb98c',
  down: '#ff5a5e',
  downWick: '#ff5a5e',
  crosshair: '#737373',
  volumeUp: 'rgba(91, 185, 140, 0.25)',
  volumeDown: 'rgba(255, 90, 94, 0.25)',
} as const;

function isValidOHLC(c: PriceChartDatum): boolean {
  return (
    Number.isFinite(c.open) &&
    Number.isFinite(c.high) &&
    Number.isFinite(c.low) &&
    Number.isFinite(c.close) &&
    c.open > 0 &&
    c.high > 0 &&
    c.low > 0 &&
    c.close > 0 &&
    c.high >= c.low
  );
}

/**
 * Filter out bad data points: invalid OHLC values and zero-volume spike candles.
 * Zero-volume spikes are a common Yahoo Finance artifact during extended-hours
 * and session boundaries — no real trades happened, so the OHLC is unreliable.
 */
function sanitize(data: PriceChartDatum[]): PriceChartDatum[] {
  if (data.length < 3) return data.filter(isValidOHLC);

  const NEIGHBOR_WINDOW = 5;
  const SPIKE_FACTOR = 2;

  return data.filter((candle, i) => {
    if (!isValidOHLC(candle)) return false;
    if (candle.volume > 0) return true;

    // Zero-volume candle — check if it's a spike relative to neighbors
    const start = Math.max(0, i - NEIGHBOR_WINDOW);
    const end = Math.min(data.length, i + NEIGHBOR_WINDOW + 1);
    const neighborRanges: number[] = [];

    for (let j = start; j < end; j++) {
      if (j !== i && isValidOHLC(data[j]) && data[j].volume > 0) {
        neighborRanges.push(data[j].high - data[j].low);
      }
    }

    if (neighborRanges.length < 2) return true;

    neighborRanges.sort((a, b) => a - b);
    const medianRange = neighborRanges[Math.floor(neighborRanges.length / 2)];
    const candleRange = candle.high - candle.low;

    return candleRange <= medianRange * SPIKE_FACTOR;
  });
}

/** Deduplicate by date key (keep last occurrence), sort chronologically. */
function dedup(data: PriceChartDatum[], intraday: boolean): PriceChartDatum[] {
  const map = new Map<string, PriceChartDatum>();
  for (const d of data) {
    if (intraday) {
      // Use full ISO string as key to preserve intraday granularity
      map.set(d.date, d);
    } else {
      const day = d.date.slice(0, 10);
      map.set(day, { ...d, date: day });
    }
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function toTime(dateStr: string, intraday: boolean): Time {
  if (intraday) {
    // Convert ISO string to Unix timestamp (seconds) for intraday
    return Math.floor(new Date(dateStr).getTime() / 1000) as UTCTimestamp;
  }
  return dateStr as Time;
}

function toChartData(data: PriceChartDatum[], intraday: boolean): CandlestickData<Time>[] {
  return data.map((d) => ({
    time: toTime(d.date, intraday),
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
  }));
}

function toVolumeData(data: PriceChartDatum[], intraday: boolean) {
  return data.map((d) => ({
    time: toTime(d.date, intraday),
    value: d.volume,
    color: d.close >= d.open ? COLORS.volumeUp : COLORS.volumeDown,
  }));
}

export function PriceChart({ data, intraday = false }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || data.length === 0) return;

    // Wait one frame so the container has layout dimensions (inside modal transitions).
    const raf = requestAnimationFrame(() => {
      const { width, height } = container.getBoundingClientRect();
      if (width === 0 || height === 0) return;

      try {
        const chart = createChart(container, {
          width,
          height,
          layout: {
            background: { type: ColorType.Solid, color: COLORS.bg },
            textColor: COLORS.text,
            fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
            fontSize: 11,
          },
          grid: {
            vertLines: { color: COLORS.border, style: 4 },
            horzLines: { color: COLORS.border, style: 4 },
          },
          crosshair: {
            vertLine: { color: COLORS.crosshair, labelBackgroundColor: COLORS.crosshair },
            horzLine: { color: COLORS.crosshair, labelBackgroundColor: COLORS.crosshair },
          },
          rightPriceScale: { borderColor: COLORS.border },
          timeScale: {
            borderColor: COLORS.border,
            timeVisible: intraday,
            fixLeftEdge: true,
            fixRightEdge: true,
          },
          handleScroll: { vertTouchDrag: false },
        });

        chartRef.current = chart;

        const clean = sanitize(dedup(data, intraday));

        const candleSeries = chart.addSeries(CandlestickSeries, {
          upColor: COLORS.up,
          downColor: COLORS.down,
          borderDownColor: COLORS.down,
          borderUpColor: COLORS.up,
          wickDownColor: COLORS.downWick,
          wickUpColor: COLORS.upWick,
        });
        candleSeries.setData(toChartData(clean, intraday));

        const volumeSeries = chart.addSeries(HistogramSeries, {
          priceFormat: { type: 'volume' },
          priceScaleId: 'volume',
        });
        chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
        volumeSeries.setData(toVolumeData(clean, intraday));

        chart.timeScale().fitContent();

        const observer = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const { width: w, height: h } = entry.contentRect;
            if (w > 0 && h > 0) chart.applyOptions({ width: w, height: h });
          }
        });
        observer.observe(container);
        observerRef.current = observer;
      } catch (err) {
        console.warn('[PriceChart] Failed to create chart', err);
      }
    });

    return () => {
      cancelAnimationFrame(raf);
      observerRef.current?.disconnect();
      observerRef.current = null;
      chartRef.current?.remove();
      chartRef.current = null;
    };
  }, [data, intraday]);

  return <div ref={containerRef} className="w-full h-[360px]" />;
}
