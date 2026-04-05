import { useState, useCallback } from 'react';
import { useClient } from 'urql';
import { cn } from '../../lib/utils';
import { SymbolLogo } from '../common/symbol-logo';
import { lookupSymbolName } from '../../lib/symbol-names';
import { QUOTE_QUERY } from '../../api/documents';
import type { QuoteQueryResult, QuoteQueryVariables } from '../../api/types';

export interface ExtractedPosition {
  symbol: string;
  name: string;
  quantity: number | null;
  avgEntry: number | null;
  marketPrice: number | null;
  marketValue: number | null;
}

interface EditableTableProps {
  positions: ExtractedPosition[];
  onChange: (positions: ExtractedPosition[]) => void;
  assetClass?: 'equity' | 'crypto';
  className?: string;
}

interface EditingCell {
  row: number;
  field: keyof ExtractedPosition;
}

/** Red-tinted pill shown for fields the screenshot couldn't extract. */
function MissingBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-error/10 px-1.5 py-0.5 text-xs text-error">
      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
        />
      </svg>
      missing
    </span>
  );
}

const PAGE_SIZE = 10;

export function EditableTable({ positions, onChange, assetClass = 'equity', className }: EditableTableProps) {
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [editValue, setEditValue] = useState('');
  const [page, setPage] = useState(0);
  const urqlClient = useClient();

  const totalPages = Math.max(1, Math.ceil(positions.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);

  const pageStart = currentPage * PAGE_SIZE;
  const pagePositions = positions.slice(pageStart, pageStart + PAGE_SIZE);

  const startEdit = useCallback(
    (row: number, field: keyof ExtractedPosition) => {
      const val = positions[row][field];
      setEditValue(val != null ? String(val) : '');
      setEditing({ row, field });
    },
    [positions],
  );

  const commitEdit = useCallback(() => {
    if (!editing) return;
    const updated = [...positions];
    const { row, field } = editing;
    if (field === 'symbol') {
      const resolved = lookupSymbolName(editValue);
      updated[row] = { ...updated[row], symbol: editValue, name: resolved || updated[row].name };

      // Resolve name via API when static lookup misses
      if (!resolved && editValue.trim()) {
        const sym = editValue.trim().toUpperCase();
        const rowIdx = row;
        urqlClient
          .query<QuoteQueryResult, QuoteQueryVariables>(QUOTE_QUERY, { symbol: sym })
          .toPromise()
          .then((result) => {
            const name = result.data?.quote?.name;
            if (name) {
              // Re-read positions from the committed update (updated array)
              onChange(updated.map((p, i) => (i === rowIdx && p.symbol.toUpperCase() === sym ? { ...p, name } : p)));
            }
          });
      }
    } else {
      const num = parseFloat(editValue);
      updated[row] = { ...updated[row], [field]: Number.isNaN(num) ? null : num };
    }
    onChange(updated);
    setEditing(null);
  }, [editing, editValue, positions, onChange, urqlClient]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') commitEdit();
      if (e.key === 'Escape') setEditing(null);
    },
    [commitEdit],
  );

  const removeRow = useCallback(
    (index: number) => {
      onChange(positions.filter((_, i) => i !== index));
    },
    [positions, onChange],
  );

  const addRow = useCallback(() => {
    onChange([
      ...positions,
      { symbol: '', name: '', quantity: null, avgEntry: null, marketPrice: null, marketValue: null },
    ]);
    // Jump to the last page and start editing the symbol cell of the new row
    const newLastPage = Math.floor(positions.length / PAGE_SIZE);
    setPage(newLastPage);
    setTimeout(() => {
      setEditValue('');
      setEditing({ row: positions.length, field: 'symbol' });
    }, 0);
  }, [positions, onChange]);

  return (
    <div className={cn('overflow-hidden rounded-xl border border-border', className)}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="bg-bg-secondary">
              <th className="py-2.5 pl-4 pr-2 text-left text-2xs font-medium uppercase tracking-wider text-text-muted w-[130px]">
                Symbol
              </th>
              <th className="px-2 py-2.5 text-left text-2xs font-medium uppercase tracking-wider text-text-muted">
                Name
              </th>
              <th className="px-2 py-2.5 text-right text-2xs font-medium uppercase tracking-wider text-text-muted w-[90px]">
                Qty
              </th>
              <th className="px-2 py-2.5 text-right text-2xs font-medium uppercase tracking-wider text-text-muted w-[100px]">
                Avg Entry
              </th>
              <th className="px-2 py-2.5 text-right text-2xs font-medium uppercase tracking-wider text-text-muted w-[100px]">
                Value
              </th>
              <th className="w-8 pr-3" />
            </tr>
          </thead>
          <tbody>
            {pagePositions.map((pos, i) => {
              const rowIdx = pageStart + i;
              const editingSymbol = editing?.row === rowIdx && editing?.field === 'symbol';
              const editingQty = editing?.row === rowIdx && editing?.field === 'quantity';
              const editingEntry = editing?.row === rowIdx && editing?.field === 'avgEntry';
              return (
                <tr key={rowIdx} className="border-t border-border hover:bg-bg-hover/30">
                  {/* Symbol */}
                  <td className="py-2 pl-4 pr-2">
                    {editingSymbol ? (
                      <input
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={handleKeyDown}
                        className="w-full rounded bg-bg-tertiary px-2 py-1 text-sm text-text-primary outline-none ring-1 ring-accent-primary/40"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEdit(rowIdx, 'symbol')}
                        className="cursor-pointer flex items-center gap-2 rounded px-1 py-0.5 hover:bg-bg-tertiary"
                      >
                        {pos.symbol ? (
                          <>
                            <SymbolLogo symbol={pos.symbol} assetClass={assetClass} size="sm" />
                            <span className="text-sm font-medium text-text-primary">{pos.symbol}</span>
                          </>
                        ) : (
                          <MissingBadge />
                        )}
                      </button>
                    )}
                  </td>
                  {/* Name (read-only, auto-detected from symbol) */}
                  <td className="px-2 py-2">
                    <span className="block truncate px-1 py-0.5 text-sm text-text-muted">{pos.name || '—'}</span>
                  </td>
                  {/* Qty */}
                  <td className="px-2 py-2 text-right">
                    {editingQty ? (
                      <input
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={handleKeyDown}
                        className="w-full rounded bg-bg-tertiary px-2 py-1 text-right text-sm text-text-primary outline-none ring-1 ring-accent-primary/40"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEdit(rowIdx, 'quantity')}
                        className="cursor-pointer rounded px-1 py-0.5 text-sm text-text-primary hover:bg-bg-tertiary"
                      >
                        {pos.quantity != null ? Number(pos.quantity).toLocaleString() : <MissingBadge />}
                      </button>
                    )}
                  </td>
                  {/* Avg Entry */}
                  <td className="px-2 py-2 text-right">
                    {editingEntry ? (
                      <input
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={handleKeyDown}
                        className="w-full rounded bg-bg-tertiary px-2 py-1 text-right text-sm text-text-primary outline-none ring-1 ring-accent-primary/40"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEdit(rowIdx, 'avgEntry')}
                        className="cursor-pointer rounded px-1 py-0.5 text-sm text-text-primary hover:bg-bg-tertiary"
                      >
                        {pos.avgEntry != null ? `$${Number(pos.avgEntry).toLocaleString()}` : <MissingBadge />}
                      </button>
                    )}
                  </td>
                  {/* Value (derived: qty × mkt price, falls back to qty × avg entry) */}
                  <td className="px-2 py-2 text-right">
                    <span className="px-1 py-0.5 text-sm text-text-primary">
                      {pos.quantity != null && (pos.marketPrice ?? pos.avgEntry) != null ? (
                        `$${(pos.quantity * ((pos.marketPrice ?? pos.avgEntry) as number)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      ) : (
                        <MissingBadge />
                      )}
                    </span>
                  </td>
                  {/* Delete */}
                  <td className="pr-3 text-center">
                    <button
                      type="button"
                      onClick={() => removeRow(rowIdx)}
                      className="cursor-pointer inline-flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-error/10 hover:text-error"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border px-4 py-2">
          <span className="text-xs text-text-muted">
            {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, positions.length)} of {positions.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
              className="cursor-pointer inline-flex h-7 w-7 items-center justify-center rounded text-text-muted transition-colors hover:bg-bg-tertiary disabled:cursor-default disabled:opacity-30"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
            </button>
            <span className="px-2 text-xs text-text-secondary">
              {currentPage + 1} / {totalPages}
            </span>
            <button
              type="button"
              disabled={currentPage >= totalPages - 1}
              onClick={() => setPage(currentPage + 1)}
              className="cursor-pointer inline-flex h-7 w-7 items-center justify-center rounded text-text-muted transition-colors hover:bg-bg-tertiary disabled:cursor-default disabled:opacity-30"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Add row */}
      <button
        type="button"
        onClick={addRow}
        className="cursor-pointer flex w-full items-center justify-center gap-1.5 border-t border-border py-2.5 text-sm text-text-muted transition-colors hover:bg-bg-hover/40 hover:text-text-secondary"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Add position
      </button>

      {positions.length === 0 && (
        <div className="px-4 py-8 text-center text-sm text-text-muted">No positions extracted</div>
      )}
    </div>
  );
}
