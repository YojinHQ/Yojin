const stats = [
  { label: 'Total Positions', value: '10' },
  { label: 'Awaiting Action', value: '3' },
  { label: 'Total Value', value: '$157,900.55' },
];

export default function PortfolioStats() {
  return (
    <div className="grid grid-cols-3 gap-4">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-xl border border-border bg-bg-card p-4">
          <p className="text-xs uppercase tracking-wider text-text-muted">{stat.label}</p>
          <p className="mt-1.5 text-lg font-semibold text-text-primary">{stat.value}</p>
        </div>
      ))}
    </div>
  );
}
