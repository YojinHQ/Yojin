import { useEffect, useRef } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type Time,
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
}

/** Color palette — matches Yojin theme tokens. */
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

function toChartData(data: PriceChartDatum[]): CandlestickData<Time>[] {
  return data.map((d) => ({
    time: d.date as Time,
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
  }));
}

function toVolumeData(data: PriceChartDatum[]) {
  return data.map((d) => ({
    time: d.date as Time,
    value: d.volume,
    color: d.close >= d.open ? COLORS.volumeUp : COLORS.volumeDown,
  }));
}

export function PriceChart({ data }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

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
      rightPriceScale: {
        borderColor: COLORS.border,
      },
      timeScale: {
        borderColor: COLORS.border,
        timeVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
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

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
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
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  // Update series data when data changes
  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!chart || !candleSeries || !volumeSeries || data.length === 0) return;

    candleSeries.setData(toChartData(data));
    volumeSeries.setData(toVolumeData(data));
    chart.timeScale().fitContent();
  }, [data]);

  return <div ref={containerRef} className="w-full h-[360px]" />;
}
