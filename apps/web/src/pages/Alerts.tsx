import Card from '../components/common/Card';
import EmptyState from '../components/common/EmptyState';

export default function Alerts() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Alerts</h2>
          <p className="mt-1 text-sm text-slate-400">
            Configure and manage portfolio alert rules. Alerts evaluate against enriched snapshots.
          </p>
        </div>
        <button
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
          disabled
        >
          + New Alert Rule
        </button>
      </div>

      {/* Active alerts */}
      <Card title="Active Alerts">
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
                d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
              />
            </svg>
          }
          title="No alert rules configured"
          description="Create alert rules to get notified about price movements, risk threshold breaches, and portfolio events."
        />
      </Card>

      {/* Alert history */}
      <Card title="Alert History">
        <div className="flex h-32 items-center justify-center">
          <p className="text-sm text-slate-500">
            Triggered alerts and digest history will appear here.
          </p>
        </div>
      </Card>
    </div>
  );
}
