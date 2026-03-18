import { useMemo, useState } from 'react';
import { cn } from '../../lib/utils';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { timeRanges, RANGE_DAYS, generateMockData } from '../../lib/mock-chart-data';
import type { TimeRange } from '../../lib/mock-chart-data';

export default function PortfolioChart() {
  const [activeRange, setActiveRange] = useState<TimeRange>('1M');
  const chartData = useMemo(() => generateMockData(RANGE_DAYS[activeRange]), [activeRange]);

  return (
    <div className="flex min-h-[100px] flex-[1.5] flex-col rounded-lg border border-border bg-bg-card px-3 pt-2 pb-1">
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
