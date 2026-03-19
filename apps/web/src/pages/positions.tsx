import { useMemo } from 'react';
import PortfolioStats from '../components/portfolio/portfolio-stats';
import PositionTable from '../components/portfolio/position-table';
import Spinner from '../components/common/spinner';
import { usePositions } from '../api';
import type { AssetClass } from '../api';
import Tabs from '../components/common/tabs';
import { useState } from 'react';

const ASSET_CLASSES: readonly AssetClass[] = ['EQUITY', 'CRYPTO', 'BOND', 'COMMODITY', 'CURRENCY', 'OTHER'] as const;
type FilterValue = 'ALL' | AssetClass;
const FILTER_VALUES: readonly FilterValue[] = ['ALL', ...ASSET_CLASSES];

export default function Positions() {
  const [{ data, fetching, error }] = usePositions();
  const [filter, setFilter] = useState<FilterValue>('ALL');

  const positions = data?.positions ?? [];

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

  const filteredPositions = useMemo(() => {
    if (filter === 'ALL') return positions;
    return positions.filter((pos) => pos.assetClass === filter);
  }, [filter, positions]);

  if (fetching) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 overflow-auto p-6 space-y-6">
        <PortfolioStats />
        <div className="text-center text-text-muted py-12">Failed to load positions.</div>
      </div>
    );
  }

  // Only show tabs for asset classes that have positions
  const activeTabs = FILTER_VALUES.filter((f) => f === 'ALL' || counts[f] > 0);

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      <PortfolioStats />
      {activeTabs.length > 2 && (
        <Tabs
          tabs={activeTabs.map((f) => ({
            label: `${f.charAt(0) + f.slice(1).toLowerCase()} (${counts[f]})`,
            value: f,
          }))}
          value={filter}
          onChange={(v) => {
            if ((FILTER_VALUES as readonly string[]).includes(v)) setFilter(v as FilterValue);
          }}
        />
      )}
      <PositionTable positions={filteredPositions} />
    </div>
  );
}
