import { PieChart } from 'lucide-react';
import { useNavigate } from 'react-router';
import { cn } from '../../../lib/utils';
import { usePositions } from '../../../api';
import Spinner from '../../common/spinner';
import RichCard from '../rich-card';

const BAR_COLORS = [
  'bg-accent-primary',
  'bg-info',
  'bg-success',
  'bg-warning',
  'bg-market',
  'bg-error',
  'bg-accent-secondary',
  'bg-text-muted',
];

function formatCurrency(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export default function AllocationCard() {
  const [{ data, fetching, error }] = usePositions();
  const navigate = useNavigate();

  if (fetching) {
    return (
      <RichCard>
        <RichCard.Header icon={PieChart} title="Allocation Breakdown" badge="PORTFOLIO" />
        <div className="flex items-center justify-center px-6 py-8">
          <Spinner size="sm" />
        </div>
      </RichCard>
    );
  }

  if (error || !data?.positions.length) {
    return (
      <RichCard>
        <RichCard.Header icon={PieChart} title="Allocation Breakdown" badge="PORTFOLIO" />
        <RichCard.Body>No position data available to analyze allocation.</RichCard.Body>
      </RichCard>
    );
  }

  const totalValue = data.positions.reduce((sum, p) => sum + p.marketValue, 0);

  // Group by asset class
  const byAssetClass = new Map<string, number>();
  for (const pos of data.positions) {
    const key = pos.assetClass;
    byAssetClass.set(key, (byAssetClass.get(key) ?? 0) + pos.marketValue);
  }
  const assetClassRows = [...byAssetClass.entries()]
    .map(([cls, value]) => ({ label: cls, value, weight: totalValue > 0 ? (value / totalValue) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);

  // Group by sector (for equities)
  const bySector = new Map<string, number>();
  for (const pos of data.positions) {
    const key = pos.sector ?? 'Other';
    bySector.set(key, (bySector.get(key) ?? 0) + pos.marketValue);
  }
  const sectorRows = [...bySector.entries()]
    .map(([sector, value]) => ({ label: sector, value, weight: totalValue > 0 ? (value / totalValue) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);

  // Top concentration
  const topPositions = [...data.positions]
    .sort((a, b) => b.marketValue - a.marketValue)
    .slice(0, 3)
    .map((p) => ({
      symbol: p.symbol,
      weight: totalValue > 0 ? ((p.marketValue / totalValue) * 100).toFixed(1) : '0',
    }));

  return (
    <RichCard>
      <RichCard.Header icon={PieChart} title="Allocation Breakdown" badge="PORTFOLIO" />
      <RichCard.Body>
        Portfolio allocation across {data.positions.length} positions totaling {formatCurrency(totalValue)}.
        {topPositions.length > 0 && (
          <> Largest holdings: {topPositions.map((p) => `${p.symbol} (${p.weight}%)`).join(', ')}.</>
        )}
      </RichCard.Body>

      {/* Asset Class Breakdown */}
      <RichCard.SectionLabel>By Asset Class</RichCard.SectionLabel>
      <div className="px-6 pb-5">
        <div className="space-y-3">
          {assetClassRows.map((row, i) => (
            <div key={row.label}>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm text-text-secondary">{row.label}</span>
                <span className="text-sm text-text-primary">
                  {formatCurrency(row.value)} <span className="text-text-muted">({row.weight.toFixed(1)}%)</span>
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-bg-tertiary">
                <div
                  className={cn('h-full rounded-full transition-all duration-500', BAR_COLORS[i % BAR_COLORS.length])}
                  style={{ width: `${row.weight}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sector Breakdown */}
      {sectorRows.length > 1 && (
        <>
          <RichCard.SectionLabel>By Sector</RichCard.SectionLabel>
          <div className="px-6 pb-5">
            <div className="space-y-3">
              {sectorRows.map((row, i) => (
                <div key={row.label}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm text-text-secondary">{row.label}</span>
                    <span className="text-sm text-text-primary">{row.weight.toFixed(1)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-bg-tertiary">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-500',
                        BAR_COLORS[i % BAR_COLORS.length],
                      )}
                      style={{ width: `${row.weight}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <RichCard.Divider />
      <RichCard.Actions
        actions={[
          {
            label: 'Risk Analysis',
            onClick: () => navigate('/chat', { state: { preset: 'Show me my concentration risk' } }),
          },
          { label: 'View Positions', onClick: () => navigate('/portfolio') },
        ]}
      />
    </RichCard>
  );
}
