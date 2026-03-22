import PortfolioValueStrip from '../components/overview/portfolio-value-strip';
import TotalValueChart from '../components/overview/total-value-chart';
import PositionsPreview from '../components/overview/positions-preview';
import AllocationChart from '../components/charts/allocation-chart';
import RightPanel from '../components/layout/right-panel';
import NewsFeed from '../components/overview/news-feed';

export default function Dashboard() {
  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden p-6 gap-5">
        <PortfolioValueStrip />
        <TotalValueChart />
        <div className="flex min-h-0 flex-1 gap-5">
          <PositionsPreview />
          <AllocationChart />
        </div>
      </div>

      {/* Right panel — unified feed */}
      <RightPanel>
        <NewsFeed />
      </RightPanel>
    </div>
  );
}
