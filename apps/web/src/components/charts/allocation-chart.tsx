import { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const ASSET_CLASSES = [
  { key: 'equities', label: 'Equities', color: '#FF5A5E' },
  { key: 'crypto', label: 'Crypto', color: '#FF8083' },
  { key: 'fixedIncome', label: 'Fixed Income', color: '#5bb98c' },
  { key: 'cash', label: 'Cash', color: '#7da9d4' },
  { key: 'other', label: 'Other', color: '#d4a34a' },
] as const;

type AllocationPoint = Record<string, string | number>;

function generateAllocationData(): AllocationPoint[] {
  const data: AllocationPoint[] = [];
  const now = new Date();

  // Starting allocation percentages (raw values — stackOffset="expand" normalizes them)
  let equities = 55;
  let crypto = 10;
  let fixedIncome = 18;
  let cash = 12;
  let other = 5;

  for (let i = 11; i >= 0; i--) {
    const date = new Date(now);
    date.setMonth(date.getMonth() - i);
    const label = date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

    // Drift allocation over time — equities & crypto grow, bonds & cash shrink
    equities += (Math.random() - 0.3) * 2;
    crypto += (Math.random() - 0.35) * 1.5;
    fixedIncome += (Math.random() - 0.55) * 1.2;
    cash += (Math.random() - 0.6) * 1;
    other += (Math.random() - 0.5) * 0.5;

    // Clamp to reasonable ranges
    equities = Math.max(40, Math.min(70, equities));
    crypto = Math.max(5, Math.min(25, crypto));
    fixedIncome = Math.max(5, Math.min(25, fixedIncome));
    cash = Math.max(3, Math.min(15, cash));
    other = Math.max(1, Math.min(8, other));

    data.push({
      month: label,
      equities: Math.round(equities * 10) / 10,
      crypto: Math.round(crypto * 10) / 10,
      fixedIncome: Math.round(fixedIncome * 10) / 10,
      cash: Math.round(cash * 10) / 10,
      other: Math.round(other * 10) / 10,
    });
  }

  return data;
}

const tooltipStyle = {
  backgroundColor: 'var(--color-bg-card)',
  border: '1px solid var(--color-border)',
  borderRadius: '8px',
  color: 'var(--color-text-primary)',
  fontSize: '11px',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Recharts Formatter type is overly strict
const formatTooltip: any = (value: number) => [`${(value * 100).toFixed(1)}%`];

export default function AllocationChart() {
  const data = useMemo(() => generateAllocationData(), []);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-bg-card p-3">
      <div className="mb-1.5 flex flex-shrink-0 items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary">Asset Allocation</h3>
        <div className="flex gap-2">
          {ASSET_CLASSES.map((a) => (
            <div key={a.key} className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: a.color }} />
              <span className="text-[10px] text-text-muted">{a.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} stackOffset="expand" margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="month"
              tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={32}
              tickFormatter={(val: number) => `${(val * 100).toFixed(0)}%`}
            />
            <Tooltip contentStyle={tooltipStyle} formatter={formatTooltip} />
            {ASSET_CLASSES.map((a) => (
              <Area
                key={a.key}
                type="monotone"
                dataKey={a.key}
                stackId="1"
                stroke={a.color}
                fill={a.color}
                fillOpacity={0.85}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
