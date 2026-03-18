import { useMemo, useState } from 'react';
import { cn } from '../../lib/utils';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const timeRanges = ['1D', '1W', '1M', '3M', '1Y', 'ALL'] as const;
type TimeRange = (typeof timeRanges)[number];

const RANGE_DAYS: Record<TimeRange, number> = {
  '1D': 1,
  '1W': 7,
  '1M': 30,
  '3M': 90,
  '1Y': 365,
  ALL: 730,
};

function generateMockData(days: number) {
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

    // Trending upward with some noise
    value += (Math.random() - 0.35) * 1200;
    value = Math.max(value, 104000);
    data.push({ date: label, value: Math.round(value * 100) / 100 });
  }

  // Ensure the last value is close to $125k
  data[data.length - 1].value = 124850.32;

  return data;
}

export default function PortfolioChart() {
  const [activeRange, setActiveRange] = useState<TimeRange>('1M');
  const chartData = useMemo(() => generateMockData(RANGE_DAYS[activeRange]), [activeRange]);

  return (
    <div className="flex min-h-[120px] flex-[3] flex-col rounded-lg border border-border bg-bg-card px-3 pt-2 pb-1">
      <div className="mb-1.5 flex flex-shrink-0 items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary">Portfolio Performance</h3>
        <div className="flex gap-0.5">
          {timeRanges.map((range) => (
            <button
              key={range}
              onClick={() => setActiveRange(range)}
              className={cn(
                'rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
                activeRange === range ? 'bg-accent-primary text-white' : 'text-text-muted hover:text-text-secondary',
              )}
            >
              {range}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="portfolioGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FF5A5E" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#FF5A5E" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }}
              axisLine={{ stroke: 'var(--color-border)' }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }}
              axisLine={{ stroke: 'var(--color-border)' }}
              tickLine={false}
              width={45}
              domain={['dataMin - 2000', 'dataMax + 2000']}
              tickFormatter={(val: number) => `$${(val / 1000).toFixed(0)}k`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--color-bg-card)',
                border: '1px solid var(--color-border)',
                borderRadius: '8px',
                color: 'var(--color-text-primary)',
              }}
              formatter={(value) => [
                `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
                'Value',
              ]}
            />
            <Area type="monotone" dataKey="value" stroke="#FF5A5E" strokeWidth={2} fill="url(#portfolioGradient)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
