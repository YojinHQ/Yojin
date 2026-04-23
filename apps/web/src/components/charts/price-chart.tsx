import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type Time,
  type UTCTimestamp,
  ColorType,
} from 'lightweight-charts';
import { parseUTC } from '../../lib/date-utils';

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
  /** Initial visible window width in milliseconds. Applied on mount and on `resetKey` change. */
  initialWindowMs: number;
  /** Bump to snap the visible range back to the initial window (e.g. on candle-size change). */
  resetKey: number;
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

// Zero-volume spikes are a Yahoo extended-hours artifact — no real trades, unreliable OHLC.
function sanitize(data: PriceChartDatum[]): PriceChartDatum[] {
  if (data.length < 3) return data.filter(isValidOHLC);

  const NEIGHBOR_WINDOW = 5;
  const SPIKE_FACTOR = 2;

  return data.filter((candle, i) => {
    if (!isValidOHLC(candle)) return false;
    if (candle.volume > 0) return true;

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

function dedup(data: PriceChartDatum[], intraday: boolean): PriceChartDatum[] {
  const map = new Map<string, PriceChartDatum>();
  for (const d of data) {
    if (intraday) {
      map.set(d.date, d);
    } else {
      const day = d.date.slice(0, 10);
      map.set(day, { ...d, date: day });
    }
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// Intraday uses the bar index as `time` so lightweight-charts collapses non-trading gaps
// (TradingView-style). Real timestamps are recovered from `barTimes` for labels/tooltips.
function toChartData(data: PriceChartDatum[], intraday: boolean): CandlestickData<Time>[] {
  return data.map((d, i) => ({
    time: intraday ? (i as UTCTimestamp) : (d.date as Time),
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
  }));
}

function toVolumeData(data: PriceChartDatum[], intraday: boolean): HistogramData<Time>[] {
  return data.map((d, i) => ({
    time: intraday ? (i as UTCTimestamp) : (d.date as Time),
    value: d.volume,
    color: d.close >= d.open ? COLORS.volumeUp : COLORS.volumeDown,
  }));
}

function buildBarTimes(data: PriceChartDatum[]): number[] {
  return data.map((d) => Math.floor(parseUTC(d.date).getTime() / 1000));
}

function formatEtTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/New_York',
  });
}

function formatEtDay(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/New_York',
  });
}

function etDayKey(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'America/New_York',
  });
}

function timeToMs(t: Time): number {
  if (typeof t === 'number') return t * 1000;
  if (typeof t === 'string') return new Date(t).getTime();
  return Date.UTC(t.year, t.month - 1, t.day);
}

function formatDailyTick(time: Time): string {
  const ms = timeToMs(time);
  const d = new Date(ms);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function formatDailyCrosshair(time: Time): string {
  const ms = timeToMs(time);
  const d = new Date(ms);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function applyInitialWindow(
  chart: IChartApi,
  candles: CandlestickData<Time>[],
  barTimes: number[],
  windowMs: number,
  intraday: boolean,
): void {
  if (candles.length === 0) return;
  let fromIndex = 0;
  if (intraday && barTimes.length > 0) {
    const lastMs = barTimes[barTimes.length - 1] * 1000;
    const cutoffMs = lastMs - windowMs;
    for (let i = 0; i < barTimes.length; i++) {
      if (barTimes[i] * 1000 >= cutoffMs) {
        fromIndex = i;
        break;
      }
    }
  } else {
    const lastMs = timeToMs(candles[candles.length - 1].time);
    const cutoffMs = lastMs - windowMs;
    for (let i = 0; i < candles.length; i++) {
      if (timeToMs(candles[i].time) >= cutoffMs) {
        fromIndex = i;
        break;
      }
    }
  }
  chart.timeScale().setVisibleLogicalRange({ from: fromIndex, to: candles.length - 0.5 });
}

export function PriceChart({ data, intraday = false, initialWindowMs, resetKey }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick', Time> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram', Time> | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [chartReady, setChartReady] = useState(false);
  const lastSnappedResetKeyRef = useRef<number | null>(null);
  const lastSnappedDataPropRef = useRef<PriceChartDatum[] | null>(null);
  const barTimesRef = useRef<number[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const raf = requestAnimationFrame(() => {
      const { width, height } = container.getBoundingClientRect();
      if (width === 0 || height === 0) return;

      try {
        // Dual-mode formatters: intraday uses bar-index `time` (number); daily+
        // uses a date string / BusinessDay. The chart instance lives across
        // candle-size switches, so these must handle both cases.
        const tickFormatter = (time: Time): string => {
          if (typeof time === 'number') {
            const idx = Math.round(time);
            const barTimes = barTimesRef.current;
            const ts = barTimes[idx];
            if (ts == null) return '';
            const prevTs = idx > 0 ? barTimes[idx - 1] : null;
            if (prevTs != null && etDayKey(prevTs) !== etDayKey(ts)) {
              return formatEtDay(ts);
            }
            return formatEtTime(ts);
          }
          return formatDailyTick(time);
        };
        const crosshairFormatter = (time: Time): string => {
          if (typeof time === 'number') {
            const idx = Math.round(time);
            const ts = barTimesRef.current[idx];
            if (ts == null) return '';
            return `${formatEtDay(ts)} ${formatEtTime(ts)}`;
          }
          return formatDailyCrosshair(time);
        };

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
            tickMarkFormatter: tickFormatter,
          },
          localization: { timeFormatter: crosshairFormatter },
          handleScroll: { vertTouchDrag: false },
        });

        chartRef.current = chart;

        candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
          upColor: COLORS.up,
          downColor: COLORS.down,
          borderDownColor: COLORS.down,
          borderUpColor: COLORS.up,
          wickDownColor: COLORS.downWick,
          wickUpColor: COLORS.upWick,
        });

        volumeSeriesRef.current = chart.addSeries(HistogramSeries, {
          priceFormat: { type: 'volume' },
          priceScaleId: 'volume',
        });
        chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

        const observer = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const { width: w, height: h } = entry.contentRect;
            if (w > 0 && h > 0) chart.applyOptions({ width: w, height: h });
          }
        });
        observer.observe(container);
        observerRef.current = observer;

        setChartReady(true);
      } catch (err) {
        console.warn('[PriceChart] Failed to create chart', err);
      }
    });

    return () => {
      cancelAnimationFrame(raf);
      observerRef.current?.disconnect();
      observerRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      chartRef.current?.remove();
      chartRef.current = null;
      lastSnappedResetKeyRef.current = null;
      lastSnappedDataPropRef.current = null;
      barTimesRef.current = [];
      setChartReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Snap only when resetKey bumps AND fresh data has arrived — urql returns
  // stale data on the first render after a candle-size change, so snapping on
  // resetKey alone would anchor the window to the old dataset's timespan.
  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!chart || !candleSeries || !volumeSeries || !chartReady || data.length === 0) return;

    chart.applyOptions({ timeScale: { timeVisible: intraday } });

    const clean = sanitize(dedup(data, intraday));
    barTimesRef.current = intraday ? buildBarTimes(clean) : [];
    const candleData = toChartData(clean, intraday);
    const volumeData = toVolumeData(clean, intraday);
    candleSeries.setData(candleData);
    volumeSeries.setData(volumeData);

    const resetKeyChanged = lastSnappedResetKeyRef.current !== resetKey;
    const dataChanged = lastSnappedDataPropRef.current !== data;
    if (resetKeyChanged && dataChanged) {
      lastSnappedResetKeyRef.current = resetKey;
      lastSnappedDataPropRef.current = data;
      applyInitialWindow(chart, candleData, barTimesRef.current, initialWindowMs, intraday);
    }
  }, [data, intraday, resetKey, initialWindowMs, chartReady]);

  return <div ref={containerRef} className="w-full h-[360px]" />;
}
