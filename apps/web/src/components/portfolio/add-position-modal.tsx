import { useState, useCallback } from 'react';
import Modal from '../common/modal';
import Button from '../common/button';
import Input from '../common/input';
import { cn } from '../../lib/utils';
import { useAddPositionModal } from '../../lib/add-position-modal-context';
import { useAddManualPosition } from '../../api';
import type { AssetClass, Platform } from '../../api';
import { lookupSymbolName } from '../../lib/symbol-names';

type Screen = 'form' | 'confirm' | 'success';

const ACCOUNT_PRESETS = ['IBKR', 'Robinhood', 'Coinbase', 'Schwab', 'Binance', 'Fidelity'];

const CRYPTO_SYMBOLS = new Set([
  'BTC',
  'ETH',
  'SOL',
  'ADA',
  'XRP',
  'DOGE',
  'DOT',
  'AVAX',
  'MATIC',
  'LINK',
  'UNI',
  'ATOM',
  'LTC',
  'BCH',
  'ALGO',
  'FIL',
  'NEAR',
  'APT',
  'ARB',
  'OP',
]);

const ACCOUNT_TO_PLATFORM: Record<string, Platform> = {
  IBKR: 'INTERACTIVE_BROKERS',
  Robinhood: 'ROBINHOOD',
  Coinbase: 'COINBASE',
  Schwab: 'SCHWAB',
  Binance: 'BINANCE',
  Fidelity: 'FIDELITY',
};

function lookupName(symbol: string): string {
  return lookupSymbolName(symbol);
}

function inferAssetClass(symbol: string): AssetClass {
  return CRYPTO_SYMBOLS.has(symbol.toUpperCase()) ? 'CRYPTO' : 'EQUITY';
}

function inferPlatform(account: string): Platform {
  return ACCOUNT_TO_PLATFORM[account] ?? account;
}

interface FormData {
  symbol: string;
  account: string;
  quantity: string;
  costBasis: string;
}

const EMPTY_FORM: FormData = { symbol: '', account: '', quantity: '', costBasis: '' };

interface AddPositionModalProps {
  onOpenAddAccount?: () => void;
}

export default function AddPositionModal({ onOpenAddAccount }: AddPositionModalProps) {
  const { open, closeModal } = useAddPositionModal();
  const [screen, setScreen] = useState<Screen>('form');
  const [formData, setFormData] = useState<FormData>({ ...EMPTY_FORM });
  const [error, setError] = useState('');
  const [{ fetching }, addManualPosition] = useAddManualPosition();

  const resolvedName = lookupName(formData.symbol);
  const qty = parseFloat(formData.quantity);
  const price = parseFloat(formData.costBasis);
  const totalValue = !isNaN(qty) && !isNaN(price) ? qty * price : 0;

  const resetState = useCallback(() => {
    setScreen('form');
    setFormData({ ...EMPTY_FORM });
    setError('');
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    closeModal();
  }, [resetState, closeModal]);

  const updateField = useCallback((field: keyof FormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setError('');
  }, []);

  const validateAndReview = useCallback(() => {
    const symbol = formData.symbol.trim();
    if (!symbol) {
      setError('Enter a ticker symbol');
      return;
    }
    if (!formData.account.trim()) {
      setError('Select or enter an account');
      return;
    }
    const q = parseFloat(formData.quantity);
    if (isNaN(q) || q <= 0) {
      setError('Enter a valid quantity');
      return;
    }
    const p = parseFloat(formData.costBasis);
    if (isNaN(p) || p <= 0) {
      setError('Enter a valid price');
      return;
    }
    setError('');
    setScreen('confirm');
  }, [formData]);

  const handleConfirm = useCallback(async () => {
    const symbol = formData.symbol.trim().toUpperCase();
    const result = await addManualPosition({
      input: {
        symbol,
        quantity: parseFloat(formData.quantity),
        costBasis: parseFloat(formData.costBasis),
        assetClass: inferAssetClass(symbol),
        platform: inferPlatform(formData.account),
      },
    });

    if (result.error) {
      setError(result.error.message);
      return;
    }
    setScreen('success');
  }, [formData, addManualPosition]);

  const handleAddAnother = useCallback(() => {
    resetState();
  }, [resetState]);

  const handleConnectAccount = useCallback(() => {
    handleClose();
    onOpenAddAccount?.();
  }, [handleClose, onOpenAddAccount]);

  const title = screen === 'form' ? 'Add Position' : screen === 'confirm' ? 'Confirm Position' : 'Position Added';

  return (
    <Modal open={open} onClose={handleClose} title={title} maxWidth="max-w-xl">
      {/* ── Form screen ── */}
      {screen === 'form' && (
        <div>
          <p className="mb-5 text-sm text-text-secondary">Add a single position to your portfolio.</p>

          {/* Symbol + Name */}
          <div className="mb-4 flex gap-3">
            <div className="w-28">
              <Input
                label="Symbol"
                placeholder="AAPL"
                value={formData.symbol}
                onChange={(e) => updateField('symbol', e.target.value.toUpperCase())}
                size="sm"
              />
            </div>
            <div className="flex-1">
              <Input
                label="Name"
                placeholder="Auto-detected"
                value={resolvedName}
                readOnly
                size="sm"
                className="opacity-60"
              />
            </div>
          </div>

          {/* Account selection */}
          <div className="mb-4">
            <label className="mb-1.5 block text-xs font-medium text-text-secondary">Account</label>
            <div className="mb-2 flex flex-wrap gap-2">
              {ACCOUNT_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => updateField('account', preset)}
                  className={cn(
                    'cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                    formData.account === preset
                      ? 'border-accent-primary/60 bg-accent-primary/15 text-text-primary'
                      : 'border-border/60 bg-bg-tertiary text-text-secondary hover:border-border-light hover:bg-bg-hover',
                  )}
                >
                  {preset}
                </button>
              ))}
            </div>
            <Input
              placeholder="Or type a custom account name"
              value={formData.account}
              onChange={(e) => updateField('account', e.target.value)}
              size="sm"
            />
          </div>

          {/* Quantity + Cost Basis */}
          <div className="mb-4 flex gap-3">
            <div className="flex-1">
              <Input
                label="Quantity"
                placeholder="10"
                type="number"
                value={formData.quantity}
                onChange={(e) => updateField('quantity', e.target.value)}
                size="sm"
              />
            </div>
            <div className="flex-1">
              <Input
                label="Avg Cost (USD)"
                placeholder="150.00"
                type="number"
                value={formData.costBasis}
                onChange={(e) => updateField('costBasis', e.target.value)}
                size="sm"
              />
            </div>
            <div className="flex-1">
              <label className="mb-1.5 block text-xs font-medium text-text-secondary">Total Value</label>
              <div className="flex h-[34px] items-center rounded-lg border border-border/60 bg-bg-card px-3 text-sm text-text-muted">
                {totalValue > 0 ? `$${totalValue.toFixed(2)}` : '—'}
              </div>
            </div>
          </div>

          {error && <p className="mb-3 text-xs font-medium text-error">{error}</p>}

          <div className="flex items-center justify-between">
            <div>
              {onOpenAddAccount && (
                <button
                  type="button"
                  onClick={handleConnectAccount}
                  className="cursor-pointer text-xs text-text-muted transition-colors hover:text-accent-primary"
                >
                  Connect an account instead
                </button>
              )}
            </div>
            <Button variant="primary" size="sm" onClick={validateAndReview}>
              Review
            </Button>
          </div>
        </div>
      )}

      {/* ── Confirm screen ── */}
      {screen === 'confirm' && (
        <div>
          <p className="mb-4 text-sm text-text-secondary">Review your position before adding.</p>
          <div className="mb-5 rounded-xl border border-border/60 bg-bg-card p-4">
            <div className="space-y-3">
              <SummaryRow label="Symbol" value={formData.symbol.toUpperCase()} />
              {resolvedName && <SummaryRow label="Name" value={resolvedName} />}
              <SummaryRow label="Account" value={formData.account} />
              <SummaryRow label="Quantity" value={qty.toString()} />
              <SummaryRow label="Avg Cost" value={`$${price.toFixed(2)}`} />
              <div className="border-t border-border/40 pt-3">
                <SummaryRow label="Total Value" value={`$${totalValue.toFixed(2)}`} bold />
              </div>
            </div>
          </div>

          {error && <p className="mb-3 text-xs font-medium text-error">{error}</p>}

          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setScreen('form');
                setError('');
              }}
            >
              Back
            </Button>
            <Button variant="primary" size="sm" loading={fetching} onClick={handleConfirm}>
              Confirm
            </Button>
          </div>
        </div>
      )}

      {/* ── Success screen ── */}
      {screen === 'success' && (
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-success/20">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-success"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div className="text-center">
            <h3 className="text-base font-semibold text-text-primary">Position added</h3>
            <p className="mt-1 text-sm text-text-secondary">
              {qty} {formData.symbol.toUpperCase()} @ ${price.toFixed(2)}
            </p>
          </div>
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" size="sm" onClick={handleAddAnother}>
              Add Another
            </Button>
            <Button variant="primary" size="sm" onClick={handleClose}>
              Done
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function SummaryRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-text-muted">{label}</span>
      <span className={cn('text-sm', bold ? 'font-semibold text-text-primary' : 'text-text-secondary')}>{value}</span>
    </div>
  );
}
