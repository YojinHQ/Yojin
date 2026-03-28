import { useEffect, useRef } from 'react';
import { createChart, type IChartApi, type CandlestickData, type Time, ColorType } from 'lightweight-charts';

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
  bg: '#262626',
  text: '#737373',
  border: '#3d3d3d',
  up: '#5bb98c',
  upWick: '#5bb98c',
  down: '#e57373',
  downWick: '#e57373',
  crosshair: '#737373',
  volumeUp: 'rgba(91, 185, 140, 0.25)',
  volumeDown: 'rgba(229, 115, 115, 0.25)',
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container || data.length === 0) return;

    const chart = createChart(container, {
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

    // Candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor: COLORS.up,
      downColor: COLORS.down,
      borderDownColor: COLORS.down,
      borderUpColor: COLORS.up,
      wickDownColor: COLORS.downWick,
      wickUpColor: COLORS.upWick,
    });
    candleSeries.setData(toChartData(data));

    // Volume histogram
    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    volumeSeries.setData(toVolumeData(data));

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    chart.timeScale().fitContent();

    // Resize observer
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

  return <div ref={containerRef} className="w-full h-[360px]" />;
}
