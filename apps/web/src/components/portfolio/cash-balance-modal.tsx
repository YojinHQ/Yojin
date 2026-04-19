import { useState } from 'react';
import Modal from '../common/modal';
import Button from '../common/button';
import Input from '../common/input';
import { useRemoveCashBalance, useSetCashBalance } from '../../api/hooks';
import { KNOWN_PLATFORMS, type Platform } from '../../api/types';
import { getPlatformMeta } from '../platforms/platform-meta';

export interface CashBalanceInitial {
  platform: Platform;
  currency: string;
  amount: number;
}

interface CashBalanceModalProps {
  open: boolean;
  onClose: () => void;
  /** When provided, modal is in edit mode (platform + currency are read-only, delete button shown). */
  initial?: CashBalanceInitial | null;
}

const DEFAULT_PLATFORM: Platform = 'MANUAL';
const DEFAULT_CURRENCY = 'USD';

function sanitizeAmount(value: string): string {
  // Allow digits and a single decimal point
  const cleaned = value.replace(/[^\d.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot === -1) return cleaned;
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
}

function sanitizeCurrency(value: string): string {
  return value
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase()
    .slice(0, 3);
}

export default function CashBalanceModal({ open, onClose, initial }: CashBalanceModalProps) {
  const isEdit = !!initial;
  // State is initialized from props once. Parent must remount (via `key`) to reset for a different `initial`.
  const [platform, setPlatform] = useState<Platform>(() => initial?.platform ?? DEFAULT_PLATFORM);
  const [currency, setCurrency] = useState<string>(() => initial?.currency ?? DEFAULT_CURRENCY);
  const [amount, setAmount] = useState<string>(() => (initial ? String(initial.amount) : ''));
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [, executeSet] = useSetCashBalance();
  const [, executeRemove] = useRemoveCashBalance();

  const handleSave = async () => {
    const amountNum = parseFloat(amount);
    if (!platform.trim()) {
      setError('Platform is required.');
      return;
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      setError('Currency must be a 3-letter ISO code (e.g. USD, EUR).');
      return;
    }
    if (!Number.isFinite(amountNum) || amountNum < 0) {
      setError('Amount must be a non-negative number.');
      return;
    }

    setSaving(true);
    setError(undefined);
    const result = await executeSet({ platform: platform.trim(), currency, amount: amountNum });
    setSaving(false);
    if (result.error) {
      setError(result.error.message || 'Failed to save cash balance.');
      return;
    }
    onClose();
  };

  const handleDelete = async () => {
    if (!initial) return;
    setDeleting(true);
    setError(undefined);
    const result = await executeRemove({ platform: initial.platform, currency: initial.currency });
    setDeleting(false);
    if (result.error) {
      setError(result.error.message || 'Failed to remove cash balance.');
      return;
    }
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit cash balance' : 'Add cash balance'} maxWidth="max-w-md">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="cash-platform" className="block text-sm font-medium text-text-secondary">
            Platform
          </label>
          <select
            id="cash-platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            disabled={isEdit}
            className="w-full rounded-lg border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-primary outline-none transition-colors focus-visible:border-accent-primary focus-visible:ring-2 focus-visible:ring-accent-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {KNOWN_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {getPlatformMeta(p).label}
              </option>
            ))}
            {isEdit && !KNOWN_PLATFORMS.includes(platform as (typeof KNOWN_PLATFORMS)[number]) && (
              <option value={platform}>{platform}</option>
            )}
          </select>
        </div>

        <Input
          label="Currency"
          placeholder="USD"
          value={currency}
          onChange={(e) => setCurrency(sanitizeCurrency(e.target.value))}
          readOnly={isEdit}
          hint={isEdit ? undefined : '3-letter ISO code (USD, EUR, GBP, …)'}
          maxLength={3}
        />

        <Input
          label="Amount"
          placeholder="0.00"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(sanitizeAmount(e.target.value))}
        />

        {error && <p className="text-xs text-error">{error}</p>}

        <div className="flex items-center justify-between pt-2">
          {isEdit ? (
            <Button variant="danger" size="sm" onClick={handleDelete} loading={deleting} disabled={saving}>
              Remove
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={handleSave} loading={saving} disabled={deleting}>
            {isEdit ? 'Save' : 'Add'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
