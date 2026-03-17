import ExposureBreakdown from '../components/risk/ExposureBreakdown';
import Card from '../components/common/Card';

export default function Risk() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Risk Dashboard</h2>
        <p className="mt-1 text-sm text-slate-400">
          Portfolio risk analysis including exposure, concentration, correlation, and drawdown
          metrics.
        </p>
      </div>

      {/* Risk score overview */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Overall Risk Score', value: '--' },
          { label: 'Concentration Risk', value: '--' },
          { label: 'Correlation Risk', value: '--' },
          { label: 'Max Drawdown', value: '--' },
        ].map((item) => (
          <Card key={item.label}>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
              {item.label}
            </p>
            <p className="mt-2 text-2xl font-semibold text-white">{item.value}</p>
          </Card>
        ))}
      </div>

      {/* Exposure analysis */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ExposureBreakdown />
        <Card title="Correlation Matrix">
          <div className="flex h-64 items-center justify-center">
            <p className="text-sm text-slate-500">
              Cross-asset correlation heatmap will be displayed here.
            </p>
          </div>
        </Card>
      </div>

      {/* Additional risk metrics */}
      <Card title="Earnings Calendar">
        <div className="flex h-32 items-center justify-center">
          <p className="text-sm text-slate-500">
            Upcoming earnings dates for held positions will appear here.
          </p>
        </div>
      </Card>
    </div>
  );
}
