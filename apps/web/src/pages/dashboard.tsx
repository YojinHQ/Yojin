import { useState } from 'react';
import PortfolioValueStrip from '../components/overview/portfolio-value-strip';
import TotalValueChart from '../components/overview/total-value-chart';
import PositionsPreview from '../components/overview/positions-preview';
import AllocationChart from '../components/charts/allocation-chart';
import RightPanel from '../components/layout/right-panel';
import { FeedList, newsItems, intelItems } from '../components/overview/news-feed';

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
      <div className="flex flex-1 flex-col overflow-hidden p-2 gap-1.5">
        <PortfolioValueStrip />
        <TotalValueChart />
        <div className="flex min-h-0 flex-1 gap-1.5">
          <PositionsPreview />
          <AllocationChart />
        </div>
      </div>

      {/* Right panel — RecommendationsPanel intentionally replaced by FeedList (news + intel tabs) */}
      {/* TODO: rebuild AI recommendations as a dedicated page or tab */}
      <RightPanel tabs={tabs}>
        <FeedList items={activeTab === 'news' ? newsItems : intelItems} />
      </RightPanel>
    </div>
  );
}
