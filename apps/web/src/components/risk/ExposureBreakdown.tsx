import Card from '../common/Card';
import EmptyState from '../common/EmptyState';

interface ExposureItem {
  label: string;
  percentage: number;
  color: string;
}

export default function ExposureBreakdown() {
  // Placeholder: will be wired to Risk Manager output
  const exposures: ExposureItem[] = [];

  if (exposures.length === 0) {
    return (
      <Card title="Exposure Breakdown">
        <EmptyState
          icon={
            <svg
              className="h-10 w-10"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
              />
            </svg>
          }
          title="No exposure data"
          description="Run a risk analysis to see your portfolio's sector and geography exposure breakdown."
        />
      </Card>
    );
  }

  return (
    <Card title="Exposure Breakdown">
      <div className="space-y-3">
        {exposures.map((item) => (
          <div key={item.label}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="text-slate-300">{item.label}</span>
              <span className="text-slate-400">{item.percentage.toFixed(1)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${item.percentage}%`,
                  backgroundColor: item.color,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
