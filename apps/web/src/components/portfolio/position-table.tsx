import { useCallback, useMemo, useState } from 'react';
import type { KnownPlatform, Position } from '../../api';
import { isKnownPlatform, useEditPosition, useRemovePosition } from '../../api';
import { cn } from '../../lib/utils';
import { formatPrice } from '../../lib/format';
import { useAssetDetailModal } from '../../lib/asset-detail-modal-context';
import Button from '../common/button';
import EmptyState from '../common/empty-state';
import Input from '../common/input';
import Modal from '../common/modal';
import { SymbolLogo } from '../common/symbol-logo';

function formatCurrency(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatPnl(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${formatCurrency(value)}`;
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatQuantity(value: number): string {
  if (Number.isInteger(value)) return value.toLocaleString('en-US');
  // Show up to 4 significant decimal digits, avoid floating point noise
  const str = value.toPrecision(6);
  // Remove trailing zeros after decimal
  return parseFloat(str).toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function pnlColor(value: number): string {
  if (Math.abs(value) < 0.01) return 'text-text-primary';
  return value > 0 ? 'text-success' : 'text-error';
}

const PLATFORM_BADGE = 'bg-bg-tertiary text-text-muted';

const platformLabels: Record<KnownPlatform, string> = {
  INTERACTIVE_BROKERS: 'IBKR',
  ROBINHOOD: 'Robinhood',
  COINBASE: 'Coinbase',
  SCHWAB: 'Schwab',
  BINANCE: 'Binance',
  FIDELITY: 'Fidelity',
  POLYMARKET: 'Polymarket',
  PHANTOM: 'Phantom',
  METAMASK: 'MetaMask',
  WEBULL: 'Webull',
  SOFI: 'SoFi',
  MOOMOO: 'Moomoo',
  MANUAL: 'Manual',
};

function getPlatformLabel(platform: string): string {
  return isKnownPlatform(platform) ? platformLabels[platform] : platform;
}

const TH = 'px-4 py-2.5 text-2xs font-medium uppercase tracking-wider text-text-muted';

// ---------------------------------------------------------------------------
// Group positions by symbol
// ---------------------------------------------------------------------------

export interface GroupedPosition extends Position {
  primaryPlatform: string;
  extraAccountCount: number;
  underlying: Position[];
}

export function groupPositions(positions: Position[]): GroupedPosition[] {
  const bySymbol = new Map<string, Position[]>();
  for (const pos of positions) {
    const key = pos.symbol.toUpperCase();
    const group = bySymbol.get(key);
    if (group) {
      group.push(pos);
    } else {
      bySymbol.set(key, [pos]);
    }
  }

  return [...bySymbol.values()].map((group) => {
    const totalQty = group.reduce((s, p) => s + p.quantity, 0);
    const totalMv = group.reduce((s, p) => s + p.marketValue, 0);
    const totalCost = group.reduce((s, p) => s + p.costBasis * p.quantity, 0);
    const totalPnl = group.reduce((s, p) => s + p.unrealizedPnl, 0);
    const weightedCost = totalQty > 0 ? totalCost / totalQty : 0;
    const pnlPct = totalCost > 0 ? ((totalMv - totalCost) / totalCost) * 100 : 0;

    // Primary platform = largest allocation by market value
    const sorted = [...group].sort((a, b) => b.marketValue - a.marketValue);
    const primary = sorted[0];
    const distinctPlatforms = new Set(group.map((p) => p.platform));

    return {
      ...primary,
      quantity: totalQty,
      costBasis: weightedCost,
      currentPrice: totalQty > 0 ? totalMv / totalQty : primary.currentPrice,
      marketValue: totalMv,
      unrealizedPnl: totalPnl,
      unrealizedPnlPercent: pnlPct,
      primaryPlatform: primary.platform,
      extraAccountCount: distinctPlatforms.size - 1,
      underlying: sorted,
    };
  });
}

// ---------------------------------------------------------------------------
// Platform selector (shared by Edit & Remove modals)
// ---------------------------------------------------------------------------

function PlatformSelector({
  positions,
  selected,
  onSelect,
}: {
  positions: Position[];
  selected: string;
  onSelect: (platform: string) => void;
}) {
  if (positions.length <= 1) return null;
  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-xs font-medium text-text-secondary">Account</label>
      <div className="flex flex-wrap gap-1.5">
        {positions.map((p) => (
          <button
            key={p.platform}
            type="button"
            onClick={() => onSelect(p.platform)}
            className={cn(
              'cursor-pointer rounded-lg border px-2.5 py-1 text-2xs font-medium transition-colors',
              selected === p.platform
                ? 'border-accent-primary/40 bg-accent-primary/10 text-accent-primary'
                : 'border-border bg-bg-tertiary text-text-muted hover:text-text-primary hover:border-border-light',
            )}
          >
            {getPlatformLabel(p.platform)}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Position Table
// ---------------------------------------------------------------------------

export default function PositionTable({ positions, onAdd }: { positions: Position[]; onAdd?: () => void }) {
  const { openAssetDetail } = useAssetDetailModal();
  const totalValue = useMemo(() => positions.reduce((sum, p) => sum + p.marketValue, 0), [positions]);
  const [editingGroup, setEditingGroup] = useState<Position[] | null>(null);
  const [removingGroup, setRemovingGroup] = useState<Position[] | null>(null);

  // Group by symbol, then sort by value descending
  const grouped = useMemo(() => {
    const groups = groupPositions(positions);
    return groups.sort((a, b) => b.marketValue - a.marketValue);
  }, [positions]);

  if (positions.length === 0) {
    return <EmptyState title="No positions found" description="Import a portfolio to see your positions." />;
  }

  return (
    <>
      <div className="max-h-[75vh] overflow-y-auto rounded-xl border border-border bg-bg-card">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 z-10 bg-bg-tertiary">
            <tr>
              <th className={TH} />
              <th className={TH}>Account</th>
              <th className={cn(TH, 'text-right')}>Qty</th>
              <th className={cn(TH, 'text-right whitespace-nowrap')}>Avg Entry</th>
              <th className={cn(TH, 'text-right')}>Price</th>
              <th className={cn(TH, 'text-right')}>Value</th>
              <th className={cn(TH, 'text-right')}>P&L ($)</th>
              <th className={cn(TH, 'text-right')}>P&L (%)</th>
              <th className={cn(TH, 'text-right')}>Weight</th>
              <th className={cn(TH, 'w-16')}>
                {onAdd && (
                  <button
                    type="button"
                    title="Add position"
                    onClick={onAdd}
                    className="cursor-pointer rounded p-0.5 text-text-muted hover:text-accent-primary hover:bg-accent-primary/10 transition-colors"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                  </button>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {grouped.map((pos) => {
              const weight = totalValue > 0 ? (pos.marketValue / totalValue) * 100 : 0;

              return (
                <tr
                  key={pos.symbol}
                  onClick={() => openAssetDetail(pos.symbol)}
                  className="border-t border-border transition-colors hover:bg-bg-hover group cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <SymbolLogo
                        symbol={pos.symbol}
                        assetClass={pos.assetClass.toLowerCase() as 'equity' | 'crypto'}
                        size="md"
                      />
                      <div>
                        <span className="font-medium text-text-primary">{pos.symbol}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="group/tip relative inline-block">
                      <span className={cn('inline-block rounded px-1.5 py-0.5 text-2xs font-medium', PLATFORM_BADGE)}>
                        {getPlatformLabel(pos.primaryPlatform)}
                        {pos.extraAccountCount > 0 && (
                          <span className="ml-1 text-text-muted/70">+{pos.extraAccountCount}</span>
                        )}
                      </span>
                      {pos.extraAccountCount > 0 && (
                        <div className="pointer-events-none absolute left-0 top-full z-10 mt-1 hidden rounded-lg border border-border bg-bg-secondary px-3 py-2 shadow-lg group-hover/tip:block">
                          {pos.underlying.map((p) => (
                            <div key={p.platform} className="whitespace-nowrap text-2xs text-text-secondary py-0.5">
                              {getPlatformLabel(p.platform)}
                              <span className="ml-2 text-text-muted">{formatCurrency(p.marketValue)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                    {formatQuantity(pos.quantity)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                    {formatPrice(pos.costBasis)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-text-primary">
                    {formatPrice(pos.currentPrice)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-text-primary">
                    {formatCurrency(pos.marketValue)}
                  </td>
                  <td className={cn('px-4 py-3 text-right tabular-nums font-medium', pnlColor(pos.unrealizedPnl))}>
                    {formatPnl(pos.unrealizedPnl)}
                  </td>
                  <td
                    className={cn('px-4 py-3 text-right tabular-nums font-medium', pnlColor(pos.unrealizedPnlPercent))}
                  >
                    {formatPercent(pos.unrealizedPnlPercent)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-text-primary">
                    {parseFloat(weight.toFixed(1))}%
                  </td>
                  <td className="px-2 py-3">
                    <div
                      className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        title="Edit position"
                        onClick={() => setEditingGroup(pos.underlying)}
                        className="cursor-pointer rounded p-1 text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
                      >
                        <svg
                          className="h-3.5 w-3.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={1.5}
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
                          />
                        </svg>
                      </button>
                      <button
                        type="button"
                        title="Remove position"
                        onClick={() => setRemovingGroup(pos.underlying)}
                        className="cursor-pointer rounded p-1 text-text-muted hover:text-error hover:bg-error/10 transition-colors"
                      >
                        <svg
                          className="h-3.5 w-3.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={1.5}
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                          />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editingGroup && <EditPositionModal positions={editingGroup} onClose={() => setEditingGroup(null)} />}
      {removingGroup && <RemovePositionModal positions={removingGroup} onClose={() => setRemovingGroup(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Edit Position Modal
// ---------------------------------------------------------------------------

function EditPositionModal({ positions, onClose }: { positions: Position[]; onClose: () => void }) {
  const [selectedPlatform, setSelectedPlatform] = useState(positions[0].platform);
  const selected = positions.find((p) => p.platform === selectedPlatform) ?? positions[0];

  const [quantity, setQuantity] = useState(String(selected.quantity));
  const [costBasis, setCostBasis] = useState(String(selected.costBasis));
  const [error, setError] = useState('');
  const [{ fetching }, editPosition] = useEditPosition();

  const handlePlatformChange = useCallback(
    (platform: string) => {
      setSelectedPlatform(platform);
      const pos = positions.find((p) => p.platform === platform) ?? positions[0];
      setQuantity(String(pos.quantity));
      setCostBasis(String(pos.costBasis));
      setError('');
    },
    [positions],
  );

  const handleSave = useCallback(async () => {
    const q = parseFloat(quantity);
    const p = parseFloat(costBasis);
    if (isNaN(q) || q <= 0) {
      setError('Enter a valid quantity');
      return;
    }
    if (isNaN(p) || p <= 0) {
      setError('Enter a valid price');
      return;
    }
    setError('');

    const result = await editPosition({
      symbol: selected.symbol,
      platform: selected.platform,
      input: {
        symbol: selected.symbol,
        name: selected.name,
        quantity: q,
        costBasis: p,
        assetClass: selected.assetClass,
        platform: selected.platform,
      },
    });

    if (result.error) {
      setError(result.error.message);
      return;
    }
    onClose();
  }, [quantity, costBasis, selected, editPosition, onClose]);

  const q = parseFloat(quantity);
  const p = parseFloat(costBasis);
  const totalValue = !isNaN(q) && !isNaN(p) ? q * p : 0;

  return (
    <Modal open onClose={onClose} title={`Edit ${selected.symbol}`} maxWidth="max-w-md">
      <div>
        <PlatformSelector positions={positions} selected={selectedPlatform} onSelect={handlePlatformChange} />

        <div className="mb-4 flex gap-3">
          <div className="flex-1">
            <Input
              label="Quantity"
              type="number"
              value={quantity}
              onChange={(e) => {
                setQuantity(e.target.value);
                setError('');
              }}
              size="sm"
            />
          </div>
          <div className="flex-1">
            <Input
              label="Avg Cost (USD)"
              type="number"
              value={costBasis}
              onChange={(e) => {
                setCostBasis(e.target.value);
                setError('');
              }}
              size="sm"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1.5 block text-xs font-medium text-text-secondary">Total Value</label>
            <div className="flex h-[34px] items-center rounded-lg border border-border/60 bg-bg-card px-3 text-sm text-text-muted">
              {totalValue > 0 ? `$${totalValue.toFixed(2)}` : '\u2014'}
            </div>
          </div>
        </div>

        {error && <p className="mb-3 text-xs font-medium text-error">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" loading={fetching} onClick={handleSave}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Remove Position Modal
// ---------------------------------------------------------------------------

function RemovePositionModal({ positions, onClose }: { positions: Position[]; onClose: () => void }) {
  const [selectedPlatform, setSelectedPlatform] = useState(positions[0].platform);
  const selected = positions.find((p) => p.platform === selectedPlatform) ?? positions[0];

  const [error, setError] = useState('');
  const [{ fetching }, removePosition] = useRemovePosition();

  const handleRemove = useCallback(async () => {
    setError('');
    const result = await removePosition({
      symbol: selected.symbol,
      platform: selected.platform,
    });

    if (result.error) {
      setError(result.error.message);
      return;
    }
    onClose();
  }, [selected, removePosition, onClose]);

  return (
    <Modal open onClose={onClose} title="Remove Position" maxWidth="max-w-sm">
      <div>
        <PlatformSelector
          positions={positions}
          selected={selectedPlatform}
          onSelect={(p) => {
            setSelectedPlatform(p);
            setError('');
          }}
        />

        <p className="mb-4 text-sm text-text-secondary">
          Remove <span className="font-semibold text-text-primary">{selected.symbol}</span> (
          {getPlatformLabel(selected.platform)}) from your portfolio?
        </p>

        {error && <p className="mb-3 text-xs font-medium text-error">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" loading={fetching} onClick={handleRemove}>
            Remove
          </Button>
        </div>
      </div>
    </Modal>
  );
}
