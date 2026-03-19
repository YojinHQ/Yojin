import { useState, useMemo } from 'react';
import { usePortfolio, usePositions } from '../api/hooks/use-portfolio';
import type { AssetClass } from '../api/types';
import Spinner from '../components/common/spinner';
import EmptyState from '../components/common/empty-state';
import PortfolioStats from '../components/portfolio/portfolio-stats';
import Tabs from '../components/common/tabs';
import PositionTable from '../components/portfolio/position-table';

const ASSET_FILTERS = ['all', 'EQUITY', 'CRYPTO', 'BOND', 'COMMODITY', 'OTHER'] as const;
type AssetFilter = (typeof ASSET_FILTERS)[number];

const filterLabels: Record<AssetFilter, string> = {
  all: 'All',
  EQUITY: 'Equity',
  CRYPTO: 'Crypto',
  BOND: 'Bond',
  COMMODITY: 'Commodity',
  OTHER: 'Other',
};

export default function Positions() {
  const [filter, setFilter] = useState<AssetFilter>('all');
  const [{ data: portfolioData, fetching: portfolioFetching, error: portfolioError }] = usePortfolio();
  const [{ data: positionsData, fetching: positionsFetching, error: positionsError }] = usePositions();

  const fetching = portfolioFetching || positionsFetching;
  const error = portfolioError || positionsError;
  const positions = positionsData?.positions ?? [];
  const portfolio = portfolioData?.portfolio ?? null;

  const activeFilters = useMemo(() => {
    const classCounts = new Map<AssetFilter, number>();
    classCounts.set('all', positions.length);
    for (const pos of positions) {
      const ac = pos.assetClass as AssetFilter;
      classCounts.set(ac, (classCounts.get(ac) ?? 0) + 1);
    }
    return ASSET_FILTERS.filter((f) => f === 'all' || (classCounts.get(f) ?? 0) > 0).map((f) => ({
      label: `${filterLabels[f]} (${classCounts.get(f) ?? 0})`,
      value: f,
    }));
  }, [positions]);

  const filteredPositions = useMemo(() => {
    if (filter === 'all') return positions;
    return positions.filter((pos) => pos.assetClass === (filter as AssetClass));
  }, [filter, positions]);

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
        <EmptyState title="Failed to load portfolio" description={error.message} />
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
      <Tabs
        tabs={activeFilters}
        value={filter}
        onChange={(v) => {
          if ((ASSET_FILTERS as readonly string[]).includes(v)) setFilter(v as AssetFilter);
        }}
      />
      <PositionTable positions={filteredPositions} />
    </div>
  );
}
