import { useState, useCallback } from 'react';
import { cn } from '../../lib/utils';
import { SymbolLogo } from '../common/symbol-logo';

export interface ExtractedPosition {
  symbol: string;
  name: string;
  quantity: number | null;
  avgEntry: number | null;
  marketValue: number | null;
}

interface EditableTableProps {
  positions: ExtractedPosition[];
  onChange: (positions: ExtractedPosition[]) => void;
  className?: string;
}

interface EditingCell {
  row: number;
  field: keyof ExtractedPosition;
}

export function EditableTable({ positions, onChange, className }: EditableTableProps) {
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [editValue, setEditValue] = useState('');

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
    if (field === 'symbol' || field === 'name') {
      updated[row] = { ...updated[row], [field]: editValue };
    } else {
      const num = parseFloat(editValue);
      updated[row] = { ...updated[row], [field]: Number.isNaN(num) ? null : num };
    }
    onChange(updated);
    setEditing(null);
  }, [editing, editValue, positions, onChange]);

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

  return (
    <div className={cn('overflow-hidden rounded-xl border border-border', className)}>
      <table className="w-full">
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
          {positions.map((pos, rowIdx) => {
            const editingSymbol = editing?.row === rowIdx && editing?.field === 'symbol';
            const editingName = editing?.row === rowIdx && editing?.field === 'name';
            const editingQty = editing?.row === rowIdx && editing?.field === 'quantity';
            const editingEntry = editing?.row === rowIdx && editing?.field === 'avgEntry';
            const editingValue = editing?.row === rowIdx && editing?.field === 'marketValue';

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
                      className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-bg-tertiary"
                    >
                      <SymbolLogo symbol={pos.symbol} size="sm" />
                      <span className="text-sm font-medium text-text-primary">{pos.symbol}</span>
                    </button>
                  )}
                </td>
                {/* Name */}
                <td className="px-2 py-2">
                  {editingName ? (
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
                      onClick={() => startEdit(rowIdx, 'name')}
                      className="truncate rounded px-1 py-0.5 text-sm text-text-secondary hover:bg-bg-tertiary"
                    >
                      {pos.name || '—'}
                    </button>
                  )}
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
                      className="rounded px-1 py-0.5 text-sm text-text-primary hover:bg-bg-tertiary"
                    >
                      {pos.quantity != null ? Number(pos.quantity).toLocaleString() : '—'}
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
                      className="rounded px-1 py-0.5 text-sm text-text-primary hover:bg-bg-tertiary"
                    >
                      {pos.avgEntry != null ? `$${Number(pos.avgEntry).toLocaleString()}` : '—'}
                    </button>
                  )}
                </td>
                {/* Value */}
                <td className="px-2 py-2 text-right">
                  {editingValue ? (
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
                      onClick={() => startEdit(rowIdx, 'marketValue')}
                      className="rounded px-1 py-0.5 text-sm text-text-primary hover:bg-bg-tertiary"
                    >
                      {pos.marketValue != null ? `$${Number(pos.marketValue).toLocaleString()}` : '—'}
                    </button>
                  )}
                </td>
                {/* Delete */}
                <td className="pr-3 text-center">
                  <button
                    type="button"
                    onClick={() => removeRow(rowIdx)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-error/10 hover:text-error"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {positions.length === 0 && (
        <div className="px-4 py-8 text-center text-sm text-text-muted">No positions extracted</div>
      )}
    </div>
  );
}
