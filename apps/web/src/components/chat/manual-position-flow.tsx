import { useState, useCallback, useRef, useEffect } from 'react';
import { cn } from '../../lib/utils';
import { useAddManualPosition } from '../../api';
import type { AssetClass, Platform } from '../../api';

/* ─── Form state ─── */

interface FormData {
  symbol: string;
  account: string;
  quantity: string;
  costBasis: string;
}

type Step = 'symbol' | 'account' | 'quantity' | 'price' | 'confirm' | 'success';

const STEPS: Step[] = ['symbol', 'account', 'quantity', 'price', 'confirm'];

const STEP_CONFIG: Record<Step, { title: string; subtitle: string }> = {
  symbol: { title: 'What asset?', subtitle: 'Enter a ticker or asset name' },
  account: { title: 'Which account?', subtitle: 'Where do you hold this position?' },
  quantity: { title: 'How many?', subtitle: 'Number of shares or units' },
  price: { title: 'Buying price?', subtitle: 'Average cost per share (USD)' },
  confirm: { title: 'Confirm position', subtitle: 'Review before adding' },
  success: { title: 'Position added', subtitle: '' },
};

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

function inferAssetClass(symbol: string): AssetClass {
  return CRYPTO_SYMBOLS.has(symbol.toUpperCase()) ? 'CRYPTO' : 'EQUITY';
}

const ACCOUNT_TO_PLATFORM: Record<string, Platform> = {
  IBKR: 'INTERACTIVE_BROKERS',
  Robinhood: 'ROBINHOOD',
  Coinbase: 'COINBASE',
  Schwab: 'SCHWAB',
  Binance: 'BINANCE',
  Fidelity: 'FIDELITY',
};

function inferPlatform(account: string): Platform {
  return ACCOUNT_TO_PLATFORM[account] ?? 'MANUAL';
}

/* ─── Component ─── */

interface ManualPositionFlowProps {
  onComplete: () => void;
  onCancel: () => void;
}

export default function ManualPositionFlow({ onComplete, onCancel }: ManualPositionFlowProps) {
  const [step, setStep] = useState<Step>('symbol');
  const [formData, setFormData] = useState<FormData>({ symbol: '', account: '', quantity: '', costBasis: '' });
  const [error, setError] = useState('');
  const [stepKey, setStepKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [{ fetching }, addManualPosition] = useAddManualPosition();

  // Clean up dismiss timer on unmount
  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, []);

  // Auto-focus input on step change
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, [step]);

  const stepIndex = STEPS.indexOf(step);
  const config = STEP_CONFIG[step];

  const advance = useCallback((nextStep: Step) => {
    setError('');
    setStep(nextStep);
    setStepKey((k) => k + 1);
  }, []);

  const goBack = useCallback(() => {
    setError('');
    if (stepIndex <= 0) {
      onCancel();
    } else {
      setStep(STEPS[stepIndex - 1]);
      setStepKey((k) => k + 1);
    }
  }, [stepIndex, onCancel]);

  const handleNext = useCallback(() => {
    switch (step) {
      case 'symbol':
        if (!formData.symbol.trim()) {
          setError('Enter a ticker symbol');
          return;
        }
        advance('account');
        break;
      case 'account':
        if (!formData.account.trim()) {
          setError('Select or enter an account');
          return;
        }
        advance('quantity');
        break;
      case 'quantity': {
        const qty = parseFloat(formData.quantity);
        if (isNaN(qty) || qty <= 0) {
          setError('Enter a valid quantity greater than 0');
          return;
        }
        advance('price');
        break;
      }
      case 'price': {
        const price = parseFloat(formData.costBasis);
        if (isNaN(price) || price <= 0) {
          setError('Enter a valid price greater than 0');
          return;
        }
        advance('confirm');
        break;
      }
    }
  }, [step, formData, advance]);

  const handleConfirm = useCallback(async () => {
    const quantity = parseFloat(formData.quantity);
    const costBasis = parseFloat(formData.costBasis);
    const symbol = formData.symbol.trim().toUpperCase();

    const result = await addManualPosition({
      input: {
        symbol,
        quantity,
        costBasis,
        assetClass: inferAssetClass(symbol),
        platform: inferPlatform(formData.account),
      },
    });

    if (result.error) {
      setError(result.error.message);
      return;
    }

    setStep('success');
    setStepKey((k) => k + 1);

    // Auto-dismiss after showing success
    dismissTimerRef.current = setTimeout(() => onComplete(), 2000);
  }, [formData, addManualPosition, onComplete]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && step !== 'confirm') {
        e.preventDefault();
        handleNext();
      }
    },
    [step, handleNext],
  );

  const updateField = useCallback((field: keyof FormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setError('');
  }, []);

  // ─── Success state ───
  if (step === 'success') {
    const qty = parseFloat(formData.quantity);
    const price = parseFloat(formData.costBasis);
    return (
      <div key={stepKey} className="animate-waterfall-in">
        <div className="flex flex-col items-center gap-3 py-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/20">
            <svg
              width="24"
              height="24"
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
        </div>
      </div>
    );
  }

  // ─── Confirmation step ───
  if (step === 'confirm') {
    const qty = parseFloat(formData.quantity);
    const price = parseFloat(formData.costBasis);
    const total = qty * price;
    const symbol = formData.symbol.toUpperCase();

    return (
      <div key={stepKey} className="animate-waterfall-in">
        {/* Header */}
        <div className="mb-4 flex items-center gap-3">
          <BackButton onClick={goBack} />
          <div>
            <h3 className="text-base font-semibold text-text-primary">{config.title}</h3>
            <p className="text-xs text-text-muted">{config.subtitle}</p>
          </div>
          <StepIndicator current={4} total={4} />
        </div>

        {/* Summary card */}
        <div className="rounded-xl border border-border/60 bg-bg-secondary p-4">
          <div className="space-y-3">
            <SummaryRow label="Symbol" value={symbol} />
            <SummaryRow label="Account" value={formData.account} />
            <SummaryRow label="Quantity" value={qty.toString()} />
            <SummaryRow label="Buying Price" value={`$${price.toFixed(2)}`} />
            <div className="border-t border-border/40 pt-3">
              <SummaryRow label="Total Value" value={`$${total.toFixed(2)}`} bold />
            </div>
          </div>
        </div>

        {error && <p className="mt-2 text-xs text-error">{error}</p>}

        {/* Actions */}
        <div className="mt-4 flex gap-2">
          <button
            onClick={goBack}
            className="flex-1 cursor-pointer rounded-xl border border-border/60 bg-bg-secondary px-4 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-hover"
          >
            Back
          </button>
          <button
            onClick={handleConfirm}
            disabled={fetching}
            className="flex-1 cursor-pointer rounded-xl bg-accent-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-primary/90 disabled:opacity-50"
          >
            {fetching ? 'Adding...' : 'Confirm'}
          </button>
        </div>
      </div>
    );
  }

  // ─── Input steps ───
  return (
    <div key={stepKey} className="animate-waterfall-in" onKeyDown={handleKeyDown}>
      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        <BackButton onClick={goBack} />
        <div>
          <h3 className="text-base font-semibold text-text-primary">{config.title}</h3>
          <p className="text-xs text-text-muted">{config.subtitle}</p>
        </div>
        <StepIndicator current={stepIndex} total={4} />
      </div>

      {/* Input area */}
      {step === 'symbol' && (
        <div className="space-y-2">
          <input
            ref={inputRef}
            type="text"
            value={formData.symbol}
            onChange={(e) => updateField('symbol', e.target.value.toUpperCase())}
            placeholder="e.g. AAPL, BTC, MSFT"
            className={cn(
              'w-full rounded-xl border bg-bg-card px-4 py-3 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors',
              'focus:border-accent-primary focus:ring-2 focus:ring-accent-primary/30',
              error ? 'border-error' : 'border-border/60',
            )}
          />
        </div>
      )}

      {step === 'account' && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {ACCOUNT_PRESETS.map((preset) => (
              <button
                key={preset}
                onClick={() => updateField('account', preset)}
                className={cn(
                  'cursor-pointer rounded-lg border px-3 py-2 text-sm transition-colors',
                  formData.account === preset
                    ? 'border-accent-primary/60 bg-accent-primary/15 text-text-primary'
                    : 'border-border/60 bg-bg-secondary text-text-secondary hover:border-border-light hover:bg-bg-hover',
                )}
              >
                {preset}
              </button>
            ))}
          </div>
          <input
            ref={inputRef}
            type="text"
            value={formData.account}
            onChange={(e) => updateField('account', e.target.value)}
            placeholder="Or type a custom account name"
            className={cn(
              'w-full rounded-xl border bg-bg-card px-4 py-3 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors',
              'focus:border-accent-primary focus:ring-2 focus:ring-accent-primary/30',
              error ? 'border-error' : 'border-border/60',
            )}
          />
        </div>
      )}

      {step === 'quantity' && (
        <input
          ref={inputRef}
          type="number"
          inputMode="decimal"
          value={formData.quantity}
          onChange={(e) => updateField('quantity', e.target.value)}
          placeholder="e.g. 10, 0.5, 100"
          min="0"
          step="any"
          className={cn(
            'w-full rounded-xl border bg-bg-card px-4 py-3 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors',
            'focus:border-accent-primary focus:ring-2 focus:ring-accent-primary/30',
            error ? 'border-error' : 'border-border/60',
          )}
        />
      )}

      {step === 'price' && (
        <div className="relative">
          <span className="absolute top-1/2 left-4 -translate-y-1/2 text-sm text-text-muted">$</span>
          <input
            ref={inputRef}
            type="number"
            inputMode="decimal"
            value={formData.costBasis}
            onChange={(e) => updateField('costBasis', e.target.value)}
            placeholder="e.g. 150.00"
            min="0"
            step="any"
            className={cn(
              'w-full rounded-xl border bg-bg-card py-3 pr-4 pl-8 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors',
              'focus:border-accent-primary focus:ring-2 focus:ring-accent-primary/30',
              error ? 'border-error' : 'border-border/60',
            )}
          />
        </div>
      )}

      {error && <p className="mt-2 text-xs text-error">{error}</p>}

      {/* Next button */}
      <button
        onClick={handleNext}
        className="mt-4 w-full cursor-pointer rounded-xl bg-accent-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-primary/90"
      >
        Next
      </button>
    </div>
  );
}

/* ─── Sub-components ─── */

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex h-9 w-9 flex-shrink-0 cursor-pointer items-center justify-center rounded-full bg-bg-tertiary text-text-secondary transition-colors hover:bg-bg-hover"
      aria-label="Go back"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M19 12H5M12 19l-7-7 7-7" />
      </svg>
    </button>
  );
}

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="ml-auto flex items-center gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={cn(
            'h-1.5 rounded-full transition-all duration-300',
            i <= current ? 'w-4 bg-accent-primary' : 'w-1.5 bg-bg-tertiary',
          )}
        />
      ))}
    </div>
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
