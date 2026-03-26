import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { KnownPlatform, Position } from '../../api';
import { isKnownPlatform, useEditPosition, useRemovePosition } from '../../api';
import { cn } from '../../lib/utils';
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

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

interface CollapsedPosition extends Position {
  platformCount: number;
  platforms: string[];
}

function collapsePositions(positions: Position[]): CollapsedPosition[] {
  const bySymbol = new Map<string, { positions: Position[] }>();
  for (const pos of positions) {
    const entry = bySymbol.get(pos.symbol);
    if (entry) {
      entry.positions.push(pos);
    } else {
      bySymbol.set(pos.symbol, { positions: [pos] });
    }
  }
  return [...bySymbol.values()].map(({ positions: group }) => {
    const totalQty = group.reduce((s, p) => s + p.quantity, 0);
    const totalMv = group.reduce((s, p) => s + p.marketValue, 0);
    const totalCost = group.reduce((s, p) => s + p.costBasis * p.quantity, 0);
    const totalPnl = group.reduce((s, p) => s + p.unrealizedPnl, 0);
    const weightedCost = totalQty > 0 ? totalCost / totalQty : 0;
    const pnlPct = totalCost > 0 ? ((totalMv - totalCost) / totalCost) * 100 : 0;
    const first = group[0];
    return {
      ...first,
      quantity: totalQty,
      costBasis: weightedCost,
      currentPrice: totalQty > 0 ? totalMv / totalQty : first.currentPrice,
      marketValue: totalMv,
      unrealizedPnl: totalPnl,
      unrealizedPnlPercent: pnlPct,
      platformCount: group.length,
      platforms: [...new Set(group.map((p) => p.platform))],
    };
  });
}

export default function PositionTable({ positions, onAdd }: { positions: Position[]; onAdd?: () => void }) {
  const totalValue = useMemo(() => positions.reduce((sum, p) => sum + p.marketValue, 0), [positions]);
  const [editing, setEditing] = useState<Position | null>(null);
  const [removing, setRemoving] = useState<Position | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(10);
  const [expanded, setExpanded] = useState(false);

  const collapsed = useMemo(() => collapsePositions(positions), [positions]);
  const displayPositions: (Position | CollapsedPosition)[] = expanded ? positions : collapsed;

  // Sort by value descending, then paginate
  const sorted = useMemo(() => [...displayPositions].sort((a, b) => b.marketValue - a.marketValue), [displayPositions]);
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pagePositions = sorted.slice(safePage * pageSize, safePage * pageSize + pageSize);

  // Reset to first page when positions or page size changes
  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(0);
  };

  if (positions.length === 0) {
    return <EmptyState title="No positions found" description="Import a portfolio to see your positions." />;
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border bg-bg-card">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="bg-bg-tertiary">
              <th className={TH} />
              <th className={TH}>{expanded ? 'Account' : 'Accounts'}</th>
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
            {pagePositions.map((pos, idx) => {
              const weight = totalValue > 0 ? (pos.marketValue / totalValue) * 100 : 0;

              return (
                <tr
                  key={`${pos.symbol}:${pos.platform}:${safePage * pageSize + idx}`}
                  className="border-t border-border transition-colors hover:bg-bg-hover group"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <SymbolLogo
                        symbol={pos.symbol}
                        assetClass={pos.assetClass.toLowerCase() as 'equity' | 'crypto'}
                        size="md"
                      />
                      <div>
                        <Link to={`/portfolio/${pos.symbol}`} className="font-medium text-text-primary">
                          {pos.symbol}
                        </Link>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {expanded ? (
                      <span className={cn('inline-block rounded px-1.5 py-0.5 text-2xs font-medium', PLATFORM_BADGE)}>
                        {getPlatformLabel(pos.platform)}
                      </span>
                    ) : 'platforms' in pos && (pos as CollapsedPosition).platforms.length > 1 ? (
                      <div className="group/tip relative inline-block">
                        <span
                          className={cn(
                            'inline-block rounded px-1.5 py-0.5 text-2xs font-medium cursor-default',
                            PLATFORM_BADGE,
                          )}
                        >
                          {(pos as CollapsedPosition).platforms.length} accounts
                        </span>
                        <div className="pointer-events-none absolute left-0 top-full z-10 mt-1 hidden rounded-lg border border-border bg-bg-secondary px-3 py-2 shadow-lg group-hover/tip:block">
                          {(pos as CollapsedPosition).platforms.map((pl) => (
                            <div key={pl} className="whitespace-nowrap text-2xs text-text-secondary py-0.5">
                              {getPlatformLabel(pl)}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <span className={cn('inline-block rounded px-1.5 py-0.5 text-2xs font-medium', PLATFORM_BADGE)}>
                        {getPlatformLabel(pos.platform)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                    {formatQuantity(pos.quantity)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                    {formatCurrency(pos.costBasis)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-text-primary">
                    {formatCurrency(pos.currentPrice)}
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
                    {weight.toFixed(1)}%
                  </td>
                  <td className="px-2 py-3">
                    {expanded && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          title="Edit position"
                          onClick={() => setEditing(pos)}
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
                          onClick={() => setRemoving(pos)}
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
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-2xs text-text-muted">
              <span>Rows per page</span>
              <select
                value={pageSize}
                onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                className="rounded border border-border bg-bg-tertiary px-1.5 py-0.5 text-2xs text-text-primary outline-none focus:border-accent-primary"
              >
                {PAGE_SIZE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => {
                setExpanded((v) => !v);
                setPage(0);
              }}
              className={cn(
                'flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-2xs font-medium transition-colors',
                expanded
                  ? 'border-accent-primary/40 bg-accent-primary/10 text-accent-primary'
                  : 'border-border bg-bg-tertiary text-text-muted hover:text-text-primary hover:border-border-light',
              )}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"
                />
              </svg>
              {expanded ? 'Expanded' : 'Collapsed'}
            </button>
          </div>

          <div className="flex items-center gap-3 text-2xs text-text-muted">
            <span>
              {safePage * pageSize + 1}&ndash;{Math.min((safePage + 1) * pageSize, sorted.length)} of {sorted.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={safePage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="cursor-pointer rounded p-1 text-text-muted transition-colors hover:bg-bg-tertiary hover:text-text-primary disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-text-muted"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                </svg>
              </button>
              <button
                type="button"
                disabled={safePage >= totalPages - 1}
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                className="cursor-pointer rounded p-1 text-text-muted transition-colors hover:bg-bg-tertiary hover:text-text-primary disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-text-muted"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {editing && <EditPositionModal position={editing} onClose={() => setEditing(null)} />}
      {removing && <RemovePositionModal position={removing} onClose={() => setRemoving(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Edit Position Modal
// ---------------------------------------------------------------------------

function EditPositionModal({ position, onClose }: { position: Position; onClose: () => void }) {
  const [quantity, setQuantity] = useState(String(position.quantity));
  const [costBasis, setCostBasis] = useState(String(position.costBasis));
  const [error, setError] = useState('');
  const [{ fetching }, editPosition] = useEditPosition();

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
      symbol: position.symbol,
      platform: position.platform,
      input: {
        symbol: position.symbol,
        name: position.name,
        quantity: q,
        costBasis: p,
        assetClass: position.assetClass,
        platform: position.platform,
      },
    });

    if (result.error) {
      setError(result.error.message);
      return;
    }
    onClose();
  }, [quantity, costBasis, position, editPosition, onClose]);

  const q = parseFloat(quantity);
  const p = parseFloat(costBasis);
  const totalValue = !isNaN(q) && !isNaN(p) ? q * p : 0;

  return (
    <Modal open onClose={onClose} title={`Edit ${position.symbol}`} maxWidth="max-w-md">
      <div>
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

function RemovePositionModal({ position, onClose }: { position: Position; onClose: () => void }) {
  const [error, setError] = useState('');
  const [{ fetching }, removePosition] = useRemovePosition();

  const handleRemove = useCallback(async () => {
    setError('');
    const result = await removePosition({
      symbol: position.symbol,
      platform: position.platform,
    });

    if (result.error) {
      setError(result.error.message);
      return;
    }
    onClose();
  }, [position, removePosition, onClose]);

  return (
    <Modal open onClose={onClose} title="Remove Position" maxWidth="max-w-sm">
      <div>
        <p className="mb-4 text-sm text-text-secondary">
          Remove <span className="font-semibold text-text-primary">{position.symbol}</span> (
          {getPlatformLabel(position.platform)}) from your portfolio?
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
