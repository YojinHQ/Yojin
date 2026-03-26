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
      {/* Main content — 2-col × 3-row grid with locked row ratios */}
      <div className="grid flex-1 grid-cols-2 grid-rows-[1.3fr_4fr_2.5fr] gap-5 overflow-hidden p-6">
        <PortfolioValueCard />
        <ConnectedAccountsCard />
        <PortfolioOverview />
        <PositionsPreview />
        <YojinSnapCard />
        <YojinActionsCard />
      </div>

      {/* Right panel — unified feed */}
      <RightPanel>
        <NewsFeed />
      </RightPanel>
    </div>
  );
}
