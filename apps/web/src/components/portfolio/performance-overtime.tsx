import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { tooltipStyle } from '../../lib/mock-chart-data';
// CartesianGrid removed — axes hidden, date + $ shown on hover only
import { getPnlData, type TimeScale } from '../../data/mocks/performance';

const GREEN = '#4ade80';
const RED = '#f87171';

interface PerformanceOvertimeProps {
  scale: TimeScale;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Recharts tooltip payload type
function PnlTooltip({ active, payload, label }: any) {
  if (!active || !payload?.[0]) return null;
  const value = payload[0].value as number;
  const isPositive = value >= 0;
  const formatted = `${isPositive ? '+' : '-'}$${Math.abs(value).toLocaleString('en-US')}`;

  return (
    <div style={tooltipStyle}>
      <p style={{ margin: 0, padding: '4px 8px' }}>
        <span style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
        {' · '}
        <span style={{ color: isPositive ? GREEN : RED, fontWeight: 600 }}>{formatted}</span>
      </p>
    </div>
  );
}

export function PerformanceOvertime({ scale }: PerformanceOvertimeProps) {
  const data = useMemo(() => getPnlData(scale), [scale]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
        <XAxis dataKey="date" hide />
        <YAxis hide />
        <Tooltip content={<PnlTooltip />} cursor={{ fill: 'var(--color-bg-hover)', opacity: 0.5 }} />
        <Bar dataKey="pnl" radius={[2, 2, 0, 0]}>
          {data.map((entry, index) => (
            <Cell key={index} fill={entry.pnl >= 0 ? GREEN : RED} fillOpacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
