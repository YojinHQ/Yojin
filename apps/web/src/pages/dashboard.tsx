import { AlertTriangle } from 'lucide-react';

import RightPanel from '../components/layout/right-panel';
import ConnectedAccountsCard from '../components/overview/connected-accounts-card';
import IntelFeed from '../components/overview/intel-feed';
import IntelSummaryCard from '../components/overview/intel-summary-card';
import PortfolioValueCard from '../components/overview/portfolio-value-card';
import PositionsPreview from '../components/overview/positions-preview';
import YojinSnapCard from '../components/overview/yojin-snap-card';
import { PortfolioOverview } from '../components/portfolio/portfolio-overview';
import { usePortfolio } from '../api';

export default function Dashboard() {
  const [{ data: portfolioData }] = usePortfolio();
  const hasData = (portfolioData?.portfolio?.positions?.length ?? 0) > 0;
  const warnings = portfolioData?.portfolio?.warnings ?? [];

  // Equal-height rows for empty/gated states; weighted rows when data populates charts/tables.
  const gridRows = hasData ? 'grid-rows-[1.3fr_4fr_2.5fr]' : 'grid-rows-[1fr_1fr_1fr]';

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex flex-1 flex-col overflow-hidden">
        {warnings.length > 0 && (
          <div className="mx-6 mt-4">
            {warnings.map((warning, i) => {
              const isRateLimit = /upgrade/i.test(warning);
              return (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>
                    {isRateLimit ? (
                      <>
                        Jintel API daily request limit exceeded. Live prices are unavailable.{' '}
                        <a
                          href="https://api.jintel.ai/billing"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:text-text-primary"
                        >
                          Upgrade your plan
                        </a>{' '}
                        for higher limits.
                      </>
                    ) : (
                      warning
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {/* Main content — 2-col grid with locked row ratios */}
        <div className={`grid flex-1 grid-cols-2 ${gridRows} gap-5 overflow-hidden p-6`}>
          <PortfolioValueCard />
          <ConnectedAccountsCard />
          <PortfolioOverview />
          <PositionsPreview />
          <IntelSummaryCard />
          <YojinSnapCard hasPositions={hasData} />
        </div>
      </div>

      {/* Right panel — unified feed */}
      <RightPanel>
        <IntelFeed />
      </RightPanel>
    </div>
  );
}
