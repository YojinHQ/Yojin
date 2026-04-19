import { useMemo, useState } from 'react';

import type { CashBalance } from '../../api/types';
import { PlatformLogo } from '../platforms/platform-logos';
import { getPlatformMeta } from '../platforms/platform-meta';
import CashBalanceModal, { type CashBalanceInitial } from './cash-balance-modal';

interface CashBalancesCardProps {
  cashBalances: CashBalance[];
}

function formatAmount(amount: number, currency: string): string {
  try {
    return amount.toLocaleString('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    });
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export default function CashBalancesCard({ cashBalances }: CashBalancesCardProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CashBalanceInitial | null>(null);

  const sorted = useMemo(
    () =>
      [...cashBalances].sort((a, b) => {
        const labelA = getPlatformMeta(a.platform).label;
        const labelB = getPlatformMeta(b.platform).label;
        if (labelA !== labelB) return labelA.localeCompare(labelB);
        return a.currency.localeCompare(b.currency);
      }),
    [cashBalances],
  );

  const handleAdd = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const handleEdit = (entry: CashBalance) => {
    setEditing({ platform: entry.platform, currency: entry.currency, amount: entry.amount });
    setModalOpen(true);
  };

  return (
    <div className="rounded-xl border border-border bg-bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-text-muted">Cash</h3>
        <button
          type="button"
          onClick={handleAdd}
          className="cursor-pointer text-2xs font-semibold text-accent-primary transition-colors hover:text-accent-primary/80"
        >
          +Add Cash
        </button>
      </div>

      {sorted.length === 0 ? (
        <p className="py-2 text-xs text-text-muted">
          No cash balances yet. Track uninvested cash per platform to see it alongside your positions.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((entry) => (
            <li key={`${entry.platform}:${entry.currency}`}>
              <button
                type="button"
                onClick={() => handleEdit(entry)}
                aria-label={`Edit ${getPlatformMeta(entry.platform).label} ${entry.currency} cash balance`}
                className="flex w-full items-center gap-2 rounded-md border border-border-light bg-bg-secondary/50 px-2.5 py-2 text-left transition-colors hover:border-accent-primary/40 hover:bg-bg-hover/60 cursor-pointer"
              >
                <PlatformLogo platform={entry.platform} size="xs" className="flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-2xs font-medium text-text-primary">
                    {getPlatformMeta(entry.platform).label}
                  </div>
                  <div className="text-2xs font-semibold tabular-nums text-text-primary">
                    {formatAmount(entry.amount, entry.currency)}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {modalOpen && (
        <CashBalanceModal
          key={editing ? `${editing.platform}:${editing.currency}` : 'new'}
          open
          onClose={() => setModalOpen(false)}
          initial={editing}
        />
      )}
    </div>
  );
}
