import { useState } from 'react';
import { cn } from '../../lib/utils';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

const timeRanges = ['1D', '1W', '1M', '3M', '1Y', 'ALL'] as const;
type TimeRange = (typeof timeRanges)[number];

function generateMockData() {
  const data: { date: string; value: number }[] = [];
  let value = 106000;
  const now = new Date();

  for (let i = 29; i >= 0; i--) {
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

const chartData = generateMockData();

export default function PortfolioChart() {
  const [activeRange, setActiveRange] = useState<TimeRange>('1M');

  return (
    <div className="rounded-xl border border-border bg-bg-card p-6">
      <div className="mb-6 flex items-center justify-between">
        <h3 className="font-headline text-lg text-text-primary">Portfolio Performance</h3>
        <div className="flex gap-1">
          {timeRanges.map((range) => (
            <button
              key={range}
              onClick={() => setActiveRange(range)}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                activeRange === range
                  ? 'bg-accent-primary text-white'
                  : 'text-text-muted hover:text-text-secondary',
              )}
            >
              {range}
            </button>
          ))}
        </div>
      </div>
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="portfolioGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FF5A5E" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#FF5A5E" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#3d3d3d" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: '#888', fontSize: 12 }}
              axisLine={{ stroke: '#3d3d3d' }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: '#888', fontSize: 12 }}
              axisLine={{ stroke: '#3d3d3d' }}
              tickLine={false}
              domain={['dataMin - 2000', 'dataMax + 2000']}
              tickFormatter={(val: number) => `$${(val / 1000).toFixed(0)}k`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1a1a1a',
                border: '1px solid #3d3d3d',
                borderRadius: '8px',
                color: '#e5e5e5',
              }}
              formatter={(value: number) => [
                `$${value.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
                'Value',
              ]}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#FF5A5E"
              strokeWidth={2}
              fill="url(#portfolioGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
