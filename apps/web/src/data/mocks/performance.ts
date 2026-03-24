export const timeScales = ['7D', '1M', '3M', 'YTD'] as const;
export type TimeScale = (typeof timeScales)[number];

export interface PnlDataPoint {
  date: string;
  pnl: number;
}

function daysForScale(scale: TimeScale): number {
  const now = new Date();
  switch (scale) {
    case '7D':
      return 7;
    case '1M':
      return 30;
    case '3M':
      return 90;
    case 'YTD': {
      const startOfYear = new Date(now.getFullYear(), 0, 1);
      return Math.ceil((now.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
    }
  }
}

function generatePnlData(days: number): PnlDataPoint[] {
  const data: PnlDataPoint[] = [];
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    // Generate realistic daily P&L: slight positive bias, larger swings occasionally
    const base = (Math.random() - 0.42) * 2400;
    const spike = Math.random() > 0.85 ? (Math.random() - 0.5) * 4000 : 0;
    const pnl = Math.round(base + spike);

    data.push({ date: label, pnl });
  }

  return data;
}

const cache = new Map<TimeScale, PnlDataPoint[]>();

export function getPnlData(scale: TimeScale): PnlDataPoint[] {
  if (!cache.has(scale)) {
    cache.set(scale, generatePnlData(daysForScale(scale)));
  }
  return cache.get(scale) as PnlDataPoint[];
}
