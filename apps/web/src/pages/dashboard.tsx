import { useState } from 'react';
import PortfolioValueStrip from '../components/overview/portfolio-value-strip';
import PortfolioChart from '../components/overview/portfolio-chart';
import PositionsPreview from '../components/overview/positions-preview';
import AllocationChart from '../components/charts/allocation-chart';
import RightPanel from '../components/layout/right-panel';
import NewsFeed from '../components/overview/news-feed';
import IntelAlerts from '../components/overview/intel-alerts';

type PanelTab = 'news' | 'intel';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<PanelTab>('news');

  const tabs = [
    { label: 'News', active: activeTab === 'news', onClick: () => setActiveTab('news') },
    { label: 'Intel', active: activeTab === 'intel', onClick: () => setActiveTab('intel') },
  ];

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Main content — fixed-height dashboard, no page scroll */}
      <div className="flex flex-1 flex-col overflow-hidden p-3 gap-2">
        <PortfolioValueStrip />
        <PortfolioChart />
        <div className="flex min-h-0 flex-1 gap-2">
          <PositionsPreview />
          <AllocationChart />
        </div>
      </div>

      {/* Right panel with tabs */}
      <RightPanel tabs={tabs}>{activeTab === 'news' ? <NewsFeed /> : <IntelAlerts />}</RightPanel>
    </div>
  );
}
