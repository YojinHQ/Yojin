import { useState, useMemo } from 'react';
import PortfolioStats from '../components/portfolio/portfolio-stats';
import Tabs from '../components/common/tabs';
import PositionTable from '../components/portfolio/position-table';

const FILTER_STATUSES = ['all', 'holding', 'watching', 'pending', 'sold'] as const;
type FilterStatus = (typeof FILTER_STATUSES)[number];

const mockPositions = [
  {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    assetClass: 'Equity',
    shares: 150,
    value: 28432.5,
    date: '2024-03-15',
    status: 'holding' as const,
  },
  {
    symbol: 'MSFT',
    name: 'Microsoft Corp.',
    assetClass: 'Equity',
    shares: 85,
    value: 35221.8,
    date: '2024-01-22',
    status: 'holding' as const,
  },
  {
    symbol: 'GOOGL',
    name: 'Alphabet Inc.',
    assetClass: 'Equity',
    shares: 45,
    value: 12845.2,
    date: '2024-06-10',
    status: 'holding' as const,
  },
  {
    symbol: 'NVDA',
    name: 'NVIDIA Corp.',
    assetClass: 'Equity',
    shares: 60,
    value: 22150.75,
    date: '2024-02-08',
    status: 'holding' as const,
  },
  {
    symbol: 'BTC',
    name: 'Bitcoin',
    assetClass: 'Crypto',
    shares: 0.45,
    value: 18720.0,
    date: '2023-11-20',
    status: 'holding' as const,
  },
  {
    symbol: 'ETH',
    name: 'Ethereum',
    assetClass: 'Crypto',
    shares: 5.2,
    value: 8450.0,
    date: '2024-04-05',
    status: 'watching' as const,
  },
  {
    symbol: 'AMZN',
    name: 'Amazon.com Inc.',
    assetClass: 'Equity',
    shares: 30,
    value: 11534.0,
    date: '2024-05-18',
    status: 'holding' as const,
  },
  {
    symbol: 'TSLA',
    name: 'Tesla Inc.',
    assetClass: 'Equity',
    shares: 40,
    value: 7030.0,
    date: '2024-07-01',
    status: 'pending' as const,
  },
  {
    symbol: 'META',
    name: 'Meta Platforms',
    assetClass: 'Equity',
    shares: 25,
    value: 9875.5,
    date: '2023-12-15',
    status: 'sold' as const,
  },
  {
    symbol: 'SOL',
    name: 'Solana',
    assetClass: 'Crypto',
    shares: 120,
    value: 3640.8,
    date: '2024-08-22',
    status: 'watching' as const,
  },
];

export default function Positions() {
  const [filter, setFilter] = useState<FilterStatus>('all');

  const counts = useMemo(() => {
    const result: Record<FilterStatus, number> = {
      all: mockPositions.length,
      holding: 0,
      watching: 0,
      pending: 0,
      sold: 0,
    };
    for (const pos of mockPositions) {
      result[pos.status]++;
    }
    return result;
  }, []);

  const filteredPositions = useMemo(() => {
    if (filter === 'all') return mockPositions;
    return mockPositions.filter((pos) => pos.status === filter);
  }, [filter]);

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      <PortfolioStats />
      <Tabs
        tabs={FILTER_STATUSES.map((f) => ({
          label: `${f.charAt(0).toUpperCase() + f.slice(1)} (${counts[f]})`,
          value: f,
        }))}
        value={filter}
        onChange={(v) => {
          if ((FILTER_STATUSES as readonly string[]).includes(v)) setFilter(v as FilterStatus);
        }}
      />
      <PositionTable positions={filteredPositions} />
    </div>
  );
}
