import ActivityLog from '../components/activity/activity-log';
import RightPanel from '../components/layout/right-panel';
import ConnectedAccountsCard from '../components/overview/connected-accounts-card';
import IntelFeed from '../components/overview/intel-feed';
import PortfolioValueCard from '../components/overview/portfolio-value-card';
import PositionsPreview from '../components/overview/positions-preview';
import YojinSnapCard from '../components/overview/yojin-snap-card';
import { PortfolioOverview } from '../components/portfolio/portfolio-overview';
import { usePortfolio } from '../api';

export default function Dashboard() {
  const [{ data: portfolioData }] = usePortfolio();
  const hasData = (portfolioData?.portfolio?.positions?.length ?? 0) > 0;

  // Equal-height rows for empty/gated states; weighted rows when data populates charts/tables.
  const gridRows = hasData ? 'grid-rows-[1.3fr_4fr_2.5fr]' : 'grid-rows-[1fr_1fr_1fr]';

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Main content — 2-col grid with locked row ratios */}
      <div className={`grid flex-1 grid-cols-2 ${gridRows} gap-5 overflow-hidden p-6`}>
        <PortfolioValueCard />
        <ConnectedAccountsCard />
        <PortfolioOverview />
        <PositionsPreview />
        <YojinSnapCard />
        <ActivityLog />
      </div>

      {/* Right panel — unified feed */}
      <RightPanel>
        <IntelFeed />
      </RightPanel>
    </div>
  );
}
