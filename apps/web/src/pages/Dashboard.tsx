import PortfolioSummary from '../components/portfolio/PortfolioSummary';
import AllocationChart from '../components/charts/AllocationChart';
import Card from '../components/common/Card';

export default function Dashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Dashboard</h2>
        <p className="mt-1 text-sm text-slate-400">
          Portfolio overview and key metrics at a glance.
        </p>
      </div>

      {/* Summary cards */}
      <PortfolioSummary />

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AllocationChart />
        <Card title="Recent Activity">
          <div className="flex h-48 items-center justify-center">
            <p className="text-sm text-slate-500">No recent activity to display.</p>
          </div>
        </Card>
      </div>

      {/* Alerts row */}
      <Card title="Active Alerts">
        <div className="flex h-32 items-center justify-center">
          <p className="text-sm text-slate-500">
            No active alerts. Configure alert rules in the Alerts page.
          </p>
        </div>
      </Card>
    </div>
  );
}
