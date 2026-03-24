import PortfolioValueCard from '../components/overview/portfolio-value-card';
import ConnectedAccountsCard from '../components/overview/connected-accounts-card';
import { PortfolioOverview } from '../components/portfolio/portfolio-overview';
import PositionsPreview from '../components/overview/positions-preview';
import YojinSnapCard from '../components/overview/yojin-snap-card';
import YojinActionsCard from '../components/overview/yojin-actions-card';
import RightPanel from '../components/layout/right-panel';
import NewsFeed from '../components/overview/news-feed';
export default function Dashboard() {
  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-auto p-6 gap-5">
        {/* Row 1: Portfolio value + Connected accounts */}
        <div className="grid flex-shrink-0 grid-cols-2 gap-5">
          <PortfolioValueCard />
          <ConnectedAccountsCard />
        </div>

        {/* Row 2: Total Value chart + Top Positions */}
        <div className="grid min-h-[280px] flex-1 grid-cols-2 gap-5">
          <PortfolioOverview />
          <PositionsPreview />
        </div>

        {/* Row 3: Yojin Snap + Actions */}
        <div className="grid min-h-[320px] flex-shrink-0 grid-cols-2 gap-5">
          <YojinSnapCard />
          <YojinActionsCard />
        </div>
      </div>

      {/* Right panel — unified feed */}
      <RightPanel>
        <NewsFeed />
      </RightPanel>
    </div>
  );
}
