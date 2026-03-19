import { useState, useMemo } from 'react';
import { usePortfolio, usePositions } from '../api';
import type { AssetClass } from '../api';
import PortfolioStats from '../components/portfolio/portfolio-stats';
import PositionTable from '../components/portfolio/position-table';
import Spinner from '../components/common/spinner';
import EmptyState from '../components/common/empty-state';
import Tabs from '../components/common/tabs';

const ASSET_CLASSES: readonly AssetClass[] = ['EQUITY', 'CRYPTO', 'BOND', 'COMMODITY', 'CURRENCY', 'OTHER'] as const;
type FilterValue = 'ALL' | AssetClass;
const FILTER_VALUES: readonly FilterValue[] = ['ALL', ...ASSET_CLASSES];

const filterLabels: Record<FilterValue, string> = {
  ALL: 'All',
  EQUITY: 'Equity',
  CRYPTO: 'Crypto',
  BOND: 'Bond',
  COMMODITY: 'Commodity',
  CURRENCY: 'Currency',
  OTHER: 'Other',
};

export default function Positions() {
  const [filter, setFilter] = useState<FilterValue>('ALL');
  const [{ data: portfolioData, fetching: portfolioFetching, error: portfolioError }] = usePortfolio();
  const [{ data: positionsData, fetching: positionsFetching, error: positionsError }] = usePositions();

  const fetching = portfolioFetching || positionsFetching;
  const error = portfolioError || positionsError;
  const positions = useMemo(() => positionsData?.positions ?? [], [positionsData?.positions]);
  const portfolio = portfolioData?.portfolio ?? null;

  const counts = useMemo(() => {
    const result: Record<FilterValue, number> = {
      ALL: positions.length,
      EQUITY: 0,
      CRYPTO: 0,
      BOND: 0,
      COMMODITY: 0,
      CURRENCY: 0,
      OTHER: 0,
    };
    for (const pos of positions) {
      result[pos.assetClass]++;
    }
    return result;
  }, [positions]);

  // Only show tabs for asset classes that have positions
  const activeTabs = FILTER_VALUES.filter((f) => f === 'ALL' || counts[f] > 0);

  // Fall back to 'ALL' if the selected filter tab no longer exists (e.g. after data refresh).
  const effectiveFilter = filter !== 'ALL' && !activeTabs.includes(filter) ? 'ALL' : filter;

  const filteredPositions = useMemo(() => {
    if (effectiveFilter === 'ALL') return positions;
    return positions.filter((pos) => pos.assetClass === effectiveFilter);
  }, [effectiveFilter, positions]);

  if (fetching) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 p-6">
        <PortfolioStats portfolio={portfolio} />
        <div className="mt-6">
          <EmptyState title="Failed to load portfolio" description={error.message} />
        </div>
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="flex-1 p-6">
        <PortfolioStats portfolio={portfolio} />
        <div className="mt-6">
          <EmptyState
            title="No positions yet"
            description="Add your first position via the chat — just tell the assistant what you're holding."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6 max-w-5xl mx-auto">
      <PortfolioStats portfolio={portfolio} />
      {activeTabs.length > 2 && (
        <Tabs
          tabs={activeTabs.map((f) => ({
            label: `${filterLabels[f]} (${counts[f]})`,
            value: f,
          }))}
          value={effectiveFilter}
          onChange={(v) => {
            if ((FILTER_VALUES as readonly string[]).includes(v)) setFilter(v as FilterValue);
          }}
        />
      )}
      <PositionTable positions={filteredPositions} />
    </div>
  );
}
