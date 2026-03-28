import ActivityLog from '../components/activity/activity-log';
import RightPanel from '../components/layout/right-panel';
import ConnectedAccountsCard from '../components/overview/connected-accounts-card';
import IntelFeed from '../components/overview/intel-feed';
import PortfolioValueCard from '../components/overview/portfolio-value-card';
import PositionsPreview from '../components/overview/positions-preview';
import YojinSnapCard from '../components/overview/yojin-snap-card';
import { PortfolioOverview } from '../components/portfolio/portfolio-overview';

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
        <ActivityLog />
      </div>

      {/* Right panel — unified feed */}
      <RightPanel>
        <IntelFeed />
      </RightPanel>
    </div>
  );
}
