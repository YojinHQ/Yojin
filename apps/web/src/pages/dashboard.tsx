import { useQuery } from 'urql';

import { LATEST_INSIGHT_REPORT_QUERY } from '../api/documents';
import type { LatestInsightReportQueryResult } from '../api/types';
import RightPanel from '../components/layout/right-panel';
import IntelFeed from '../components/overview/intel-feed';
import PortfolioValueCard from '../components/overview/portfolio-value-card';
import PositionsPreview from '../components/overview/positions-preview';
import { PortfolioHealthCard } from '../components/overview/portfolio-health-card';
import { ActionItemsCard } from '../components/overview/action-items-card';
import { MacroContextCard } from '../components/overview/macro-context-card';

export default function Dashboard() {
  const [insightResult] = useQuery<LatestInsightReportQueryResult>({
    query: LATEST_INSIGHT_REPORT_QUERY,
  });
  const report = insightResult.data?.latestInsightReport ?? null;

  const insightPositions = report?.positions ?? [];

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Main content — scrollable, insight-driven layout */}
      <div className="flex flex-1 flex-col gap-5 overflow-auto p-6">
        {/* Compact portfolio value strip */}
        <PortfolioValueCard />

        {/* Positions table — full width with inline insight ratings */}
        <PositionsPreview insights={insightPositions} />

        {/* Portfolio health + Action items */}
        {report && (
          <div className="grid grid-cols-2 gap-5">
            <PortfolioHealthCard report={report} />
            <ActionItemsCard items={report.portfolio.actionItems} />
          </div>
        )}

        {/* Market context — full width */}
        {report && <MacroContextCard portfolio={report.portfolio} />}
      </div>

      {/* Right panel — unified feed */}
      <RightPanel>
        <IntelFeed />
      </RightPanel>
    </div>
  );
}
