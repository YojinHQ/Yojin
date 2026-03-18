import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

const COLORS = ['#FF5A5E', '#FF8083', '#5bb98c', '#7da9d4', '#d4a34a'];

const allocationData = [
  { name: 'Equities', value: 62, color: COLORS[0] },
  { name: 'Crypto', value: 15, color: COLORS[1] },
  { name: 'Fixed Income', value: 12, color: COLORS[2] },
  { name: 'Cash', value: 8, color: COLORS[3] },
  { name: 'Other', value: 3, color: COLORS[4] },
];

export default function AllocationChart() {
  return (
    <div className="flex w-[280px] min-h-0 flex-shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-bg-card p-3">
      <h3 className="mb-1 flex-shrink-0 text-sm font-medium text-text-primary">Allocation</h3>
      <div className="flex min-h-0 flex-1 items-center gap-3">
        <div className="aspect-square min-h-0 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={allocationData}
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={65}
                paddingAngle={2}
                dataKey="value"
              >
                {allocationData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--color-bg-card)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '8px',
                  color: 'var(--color-text-primary)',
                }}
                formatter={(value) => [`${value}%`, 'Allocation']}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-shrink-0 flex-col gap-1">
          {allocationData.map((entry) => (
            <div key={entry.name} className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
              <span className="text-[11px] text-text-secondary">{entry.name}</span>
              <span className="ml-auto text-[11px] font-medium text-text-primary">{entry.value}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
