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
      {/* Main content */}
      <div className="flex-1 overflow-auto p-6 space-y-6">
        <PortfolioValueStrip />
        <PortfolioChart />
        <PositionsPreview />
        <AllocationChart />
      </div>

      {/* Right panel with tabs */}
      <RightPanel tabs={tabs}>{activeTab === 'news' ? <NewsFeed /> : <IntelAlerts />}</RightPanel>
    </div>
  );
}
