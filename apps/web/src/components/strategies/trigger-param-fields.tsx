import { useEffect } from 'react';

import { cn } from '../../lib/utils.js';

export interface TriggerParams {
  [key: string]: unknown;
}

interface TriggerParamFieldsProps {
  type: string;
  params: TriggerParams;
  onChange: (params: TriggerParams) => void;
}

const inputClass =
  'w-full bg-bg-card border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-light';

const labelClass = 'block text-xs font-medium text-text-muted mb-1';

// --- Option constants ---

const PRICE_DIRECTION_OPTIONS = [
  { value: 'drop', label: 'Drop' },
  { value: 'rise', label: 'Rise' },
];

const DIRECTION_OPTIONS = [
  { value: 'above', label: 'Above' },
  { value: 'below', label: 'Below' },
  { value: 'crosses_above', label: 'Crosses Above' },
  { value: 'crosses_below', label: 'Crosses Below' },
];

// Keys must match those produced by mapIndicators() in
// src/strategies/portfolio-context-builder.ts — the evaluator looks up
// ctx.indicators[ticker][indicator] directly.
const INDICATOR_OPTIONS = [
  // Oscillators
  { value: 'RSI', label: 'RSI (14)' },
  { value: 'MFI', label: 'MFI (14)' },
  { value: 'WILLIAMS_R', label: 'Williams %R' },
  { value: 'STOCH_K', label: 'Stochastic %K' },
  { value: 'STOCH_D', label: 'Stochastic %D' },
  // MACD (histogram as the primary crossable value)
  { value: 'MACD', label: 'MACD Histogram' },
  { value: 'MACD_LINE', label: 'MACD Line' },
  { value: 'MACD_SIGNAL', label: 'MACD Signal' },
  // Moving averages
  { value: 'EMA', label: 'EMA (10)' },
  { value: 'EMA_50', label: 'EMA (50)' },
  { value: 'EMA_200', label: 'EMA (200)' },
  { value: 'SMA_20', label: 'SMA (20)' },
  { value: 'SMA', label: 'SMA (50)' },
  { value: 'SMA_200', label: 'SMA (200)' },
  { value: 'WMA_52', label: '52-WMA' },
  { value: 'VWMA', label: 'VWMA (20)' },
  { value: 'VWAP', label: 'VWAP' },
  // Bollinger Bands
  { value: 'BB_UPPER', label: 'Bollinger Upper' },
  { value: 'BB_MIDDLE', label: 'Bollinger Middle' },
  { value: 'BB_LOWER', label: 'Bollinger Lower' },
  { value: 'BB_WIDTH', label: 'Bollinger Band Width' },
  // Volatility & trend
  { value: 'ATR', label: 'ATR (14)' },
  { value: 'ADX', label: 'ADX' },
  { value: 'PSAR', label: 'Parabolic SAR' },
  // Volume
  { value: 'OBV', label: 'OBV' },
  // Crossover flags (1 = active, 0 = inactive) — use threshold 1 / direction "above"
  { value: 'GOLDEN_CROSS', label: 'Golden Cross (flag)' },
  { value: 'DEATH_CROSS', label: 'Death Cross (flag)' },
  { value: 'EMA_CROSS', label: 'EMA Cross (flag)' },
];

const METRIC_OPTIONS = [
  { value: 'priceToBook', label: 'Price-to-Book (P/B)' },
  { value: 'roe', label: 'ROE' },
  { value: 'sue', label: 'SUE' },
  { value: 'sentiment_momentum_24h', label: 'Sentiment Momentum 24h' },
];

const SIGNAL_TYPE_OPTIONS = [
  { value: 'NEWS', label: 'News' },
  { value: 'FUNDAMENTAL', label: 'Fundamental' },
  { value: 'SENTIMENT', label: 'Sentiment' },
  { value: 'TECHNICAL', label: 'Technical' },
  { value: 'MACRO', label: 'Macro' },
  { value: 'FILINGS', label: 'Filings' },
  { value: 'SOCIALS', label: 'Socials' },
];

// --- Reusable field components ---

interface NumberInputProps {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  placeholder?: string;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}

export function NumberInput({
  label,
  value,
  onChange,
  placeholder,
  suffix,
  min,
  max,
  step,
  className,
}: NumberInputProps) {
  return (
    <div className={className}>
      <label className={labelClass}>{label}</label>
      <div className="relative">
        <input
          type="number"
          value={value ?? ''}
          onChange={(e) => {
            const v = e.currentTarget.valueAsNumber;
            onChange(e.target.value === '' ? undefined : Number.isNaN(v) ? value : v);
          }}
          placeholder={placeholder}
          min={min}
          max={max}
          step={step}
          className={cn(inputClass, suffix && 'pr-10')}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-muted pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

interface SelectInputProps {
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}

export function SelectInput({ label, value, onChange, options, className }: SelectInputProps) {
  // Persist the displayed default so unmodified selects are included in saved params.
  useEffect(() => {
    if (value === undefined && options[0]) {
      onChange(options[0].value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally only on mount

  return (
    <div className={className}>
      <label className={labelClass}>{label}</label>
      <select
        value={value ?? options[0]?.value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

interface MultiSelectChipsProps {
  label: string;
  selected: string[];
  onChange: (selected: string[]) => void;
  options: { value: string; label: string }[];
  className?: string;
}

export function MultiSelectChips({ label, selected, onChange, options, className }: MultiSelectChipsProps) {
  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  return (
    <div className={className}>
      <label className={labelClass}>{label}</label>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const isSelected = selected.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => toggle(o.value)}
              className={cn(
                'rounded-full px-2.5 py-1 text-xs border transition-colors cursor-pointer',
                isSelected
                  ? 'bg-accent-primary/20 text-accent-primary border-accent-primary/40'
                  : 'bg-bg-tertiary text-text-muted border-border hover:border-border-light',
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// --- Per-trigger-type field renderers ---

function set(params: TriggerParams, key: string, value: unknown): TriggerParams {
  if (value === undefined) {
    const { [key]: _removed, ...rest } = params;
    return rest;
  }
  return { ...params, [key]: value };
}

function PriceMoveFields({ params, onChange }: { params: TriggerParams; onChange: (p: TriggerParams) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <SelectInput
        label="Direction"
        value={params.direction as string | undefined}
        onChange={(v) => onChange(set(params, 'direction', v))}
        options={PRICE_DIRECTION_OPTIONS}
      />
      <NumberInput
        label="Threshold"
        value={(params.threshold as number | undefined) !== undefined ? (params.threshold as number) * 100 : undefined}
        onChange={(v) => onChange(set(params, 'threshold', v !== undefined ? v / 100 : undefined))}
        placeholder="5"
        suffix="%"
        min={0}
        step={0.5}
      />
      <NumberInput
        label="Lookback"
        value={params.lookback_months as number | undefined}
        onChange={(v) => onChange(set(params, 'lookback_months', v))}
        placeholder="3"
        suffix="months"
        min={1}
        step={1}
      />
    </div>
  );
}

function IndicatorThresholdFields({
  params,
  onChange,
}: {
  params: TriggerParams;
  onChange: (p: TriggerParams) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <SelectInput
        label="Indicator"
        value={params.indicator as string | undefined}
        onChange={(v) => onChange(set(params, 'indicator', v))}
        options={INDICATOR_OPTIONS}
      />
      <NumberInput
        label="Threshold"
        value={params.threshold as number | undefined}
        onChange={(v) => onChange(set(params, 'threshold', v))}
        placeholder="70"
        step={1}
      />
      <SelectInput
        label="Direction"
        value={params.direction as string | undefined}
        onChange={(v) => onChange(set(params, 'direction', v))}
        options={DIRECTION_OPTIONS}
      />
    </div>
  );
}

function DrawdownFields({ params, onChange }: { params: TriggerParams; onChange: (p: TriggerParams) => void }) {
  // Stored as negative fraction (-0.10); displayed as positive percent (10).
  const displayValue =
    (params.threshold as number | undefined) !== undefined ? Math.abs(params.threshold as number) * 100 : undefined;
  return (
    <div className="grid grid-cols-3 gap-2">
      <NumberInput
        label="Threshold"
        value={displayValue}
        onChange={(v) => onChange(set(params, 'threshold', v !== undefined ? -(v / 100) : undefined))}
        placeholder="10"
        suffix="%"
        min={0}
        step={0.5}
      />
    </div>
  );
}

function EarningsProximityFields({
  params,
  onChange,
}: {
  params: TriggerParams;
  onChange: (p: TriggerParams) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <NumberInput
        label="Within"
        value={params.withinDays as number | undefined}
        onChange={(v) => onChange(set(params, 'withinDays', v))}
        placeholder="14"
        suffix="days"
        min={1}
        step={1}
      />
    </div>
  );
}

function MetricThresholdFields({ params, onChange }: { params: TriggerParams; onChange: (p: TriggerParams) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <SelectInput
        label="Metric"
        value={params.metric as string | undefined}
        onChange={(v) => onChange(set(params, 'metric', v))}
        options={METRIC_OPTIONS}
      />
      <NumberInput
        label="Threshold"
        value={params.threshold as number | undefined}
        onChange={(v) => onChange(set(params, 'threshold', v))}
        placeholder="1.5"
        step={0.1}
      />
      <SelectInput
        label="Direction"
        value={params.direction as string | undefined}
        onChange={(v) => onChange(set(params, 'direction', v))}
        options={DIRECTION_OPTIONS}
      />
    </div>
  );
}

function ConcentrationDriftFields({
  params,
  onChange,
}: {
  params: TriggerParams;
  onChange: (p: TriggerParams) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <NumberInput
        label="Max Weight"
        value={(params.maxWeight as number | undefined) !== undefined ? (params.maxWeight as number) * 100 : undefined}
        onChange={(v) => onChange(set(params, 'maxWeight', v !== undefined ? v / 100 : undefined))}
        placeholder="25"
        suffix="%"
        min={0}
        max={100}
        step={1}
      />
    </div>
  );
}

function SignalPresentFields({ params, onChange }: { params: TriggerParams; onChange: (p: TriggerParams) => void }) {
  const signalTypes = Array.isArray(params.signal_types) ? (params.signal_types as string[]) : [];
  const minSentiment = typeof params.min_sentiment === 'number' ? params.min_sentiment : undefined;

  return (
    <div className="space-y-3">
      <MultiSelectChips
        label="Signal Types"
        selected={signalTypes}
        onChange={(v) => onChange(set(params, 'signal_types', v))}
        options={SIGNAL_TYPE_OPTIONS}
      />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass}>Min Sentiment</label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={minSentiment ?? 0}
              onChange={(e) => onChange(set(params, 'min_sentiment', Number(e.target.value)))}
              className="flex-1 accent-accent-primary"
            />
            <span className="text-xs text-text-muted tabular-nums w-8 text-right">
              {(minSentiment ?? 0).toFixed(2)}
            </span>
          </div>
        </div>
        <NumberInput
          label="Lookback"
          value={params.lookback_hours as number | undefined}
          onChange={(v) => onChange(set(params, 'lookback_hours', v))}
          placeholder="24"
          suffix="hours"
          min={1}
          step={1}
        />
      </div>
    </div>
  );
}

function CustomFields() {
  return <p className="text-xs text-text-muted italic">Custom triggers are evaluated by the LLM at runtime</p>;
}

function AllocationDriftFields({ params, onChange }: { params: TriggerParams; onChange: (p: TriggerParams) => void }) {
  const displayPercent =
    (params.toleranceBps as number | undefined) !== undefined ? (params.toleranceBps as number) / 100 : undefined;
  return (
    <div className="grid grid-cols-3 gap-2">
      <NumberInput
        label="Tolerance"
        value={displayPercent}
        onChange={(v) => onChange(set(params, 'toleranceBps', v !== undefined ? Math.round(v * 100) : undefined))}
        placeholder="5"
        suffix="%"
        min={0}
        step={0.5}
      />
    </div>
  );
}

const PERSON_ACTION_OPTIONS = [
  { value: 'ANY', label: 'Any' },
  { value: 'BUY', label: 'Buy' },
  { value: 'SELL', label: 'Sell' },
];

function PersonActivityFields({ params, onChange }: { params: TriggerParams; onChange: (p: TriggerParams) => void }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass}>Person / Fund</label>
          <input
            type="text"
            value={(params.person as string | undefined) ?? ''}
            onChange={(e) => onChange(set(params, 'person', e.target.value || undefined))}
            placeholder="Warren Buffett"
            className={inputClass}
          />
        </div>
        <SelectInput
          label="Action"
          value={params.action as string | undefined}
          onChange={(v) => onChange(set(params, 'action', v))}
          options={PERSON_ACTION_OPTIONS}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberInput
          label="Min Dollar"
          value={params.minDollar as number | undefined}
          onChange={(v) => onChange(set(params, 'minDollar', v))}
          placeholder="100000000"
          suffix="$"
          min={0}
          step={1000000}
        />
        <NumberInput
          label="Lookback"
          value={params.lookback_days as number | undefined}
          onChange={(v) => onChange(set(params, 'lookback_days', v))}
          placeholder="90"
          suffix="days"
          min={1}
          step={1}
        />
      </div>
    </div>
  );
}

// --- Main component ---

export function TriggerParamFields({ type, params, onChange }: TriggerParamFieldsProps) {
  switch (type) {
    case 'PRICE_MOVE':
      return <PriceMoveFields params={params} onChange={onChange} />;
    case 'INDICATOR_THRESHOLD':
      return <IndicatorThresholdFields params={params} onChange={onChange} />;
    case 'DRAWDOWN':
      return <DrawdownFields params={params} onChange={onChange} />;
    case 'EARNINGS_PROXIMITY':
      return <EarningsProximityFields params={params} onChange={onChange} />;
    case 'METRIC_THRESHOLD':
      return <MetricThresholdFields params={params} onChange={onChange} />;
    case 'CONCENTRATION_DRIFT':
      return <ConcentrationDriftFields params={params} onChange={onChange} />;
    case 'SIGNAL_PRESENT':
      return <SignalPresentFields params={params} onChange={onChange} />;
    case 'ALLOCATION_DRIFT':
      return <AllocationDriftFields params={params} onChange={onChange} />;
    case 'PERSON_ACTIVITY':
      return <PersonActivityFields params={params} onChange={onChange} />;
    case 'CUSTOM':
      return <CustomFields />;
    default:
      return null;
  }
}
