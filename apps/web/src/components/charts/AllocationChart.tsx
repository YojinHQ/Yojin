import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import Card from '../common/Card';

// Placeholder data structure - will be replaced with real portfolio data
const PLACEHOLDER_DATA = [
  { name: 'Equities', value: 0, color: '#10b981' },
  { name: 'Crypto', value: 0, color: '#3b82f6' },
  { name: 'Cash', value: 0, color: '#6366f1' },
  { name: 'Other', value: 0, color: '#8b5cf6' },
];

export default function AllocationChart() {
  const hasData = PLACEHOLDER_DATA.some((d) => d.value > 0);

  return (
    <Card title="Asset Allocation">
      {hasData ? (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={PLACEHOLDER_DATA}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={2}
                dataKey="value"
              >
                {PLACEHOLDER_DATA.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  color: '#e2e8f0',
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="flex h-64 items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-slate-800">
              <svg
                className="h-8 w-8 text-slate-600"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10.5 6a7.5 7.5 0 1 0 7.5 7.5h-7.5V6Z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 10.5H21A7.5 7.5 0 0 0 13.5 3v7.5Z"
                />
              </svg>
            </div>
            <p className="text-sm text-slate-500">No allocation data available</p>
          </div>
        </div>
      )}
    </Card>
  );
}
