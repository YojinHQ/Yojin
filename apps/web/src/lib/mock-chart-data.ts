export const timeRanges = ['1D', '1W', '1M', '3M', '1Y', 'ALL'] as const;
export type TimeRange = (typeof timeRanges)[number];

export const RANGE_DAYS: Record<TimeRange, number> = {
  '1D': 1,
  '1W': 7,
  '1M': 30,
  '3M': 90,
  '1Y': 365,
  ALL: 730,
};

export function generateMockData(days: number) {
  const data: { date: string; value: number }[] = [];
  let value = 106000;
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const label = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });

    value += (Math.random() - 0.35) * 1200;
    value = Math.max(value, 104000);
    data.push({ date: label, value: Math.round(value * 100) / 100 });
  }

  data[data.length - 1].value = 124850.32;
  return data;
}

export const tooltipStyle = {
  backgroundColor: 'var(--color-bg-card)',
  border: '1px solid var(--color-border)',
  borderRadius: '8px',
  color: 'var(--color-text-primary)',
  fontSize: '12px',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Recharts Formatter type is overly strict
export const formatValue: any = (value: number | string) => [
  `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
  'Value',
];
