import PortfolioValueStrip from '../components/overview/portfolio-value-strip';
import TotalValueChart from '../components/overview/total-value-chart';
import PositionsPreview from '../components/overview/positions-preview';
import AllocationChart from '../components/charts/allocation-chart';
import RecommendationsPanel from '../components/overview/recommendations-panel';

export default function Dashboard() {
  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Main content — fixed-height dashboard, no page scroll */}
      <div className="flex flex-1 flex-col overflow-hidden p-2 gap-1.5">
        <PortfolioValueStrip />
        <TotalValueChart />
        <div className="flex min-h-0 flex-1 gap-1.5">
          <PositionsPreview />
          <AllocationChart />
        </div>
      </div>

      {/* Recommendations panel */}
      <RecommendationsPanel />
    </div>
  );
}
