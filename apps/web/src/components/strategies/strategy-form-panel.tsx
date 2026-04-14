import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';

import Button from '../common/button.js';
import { useCreateStrategy, useUpdateStrategy } from '../../api/hooks/index.js';
import { cn } from '../../lib/utils.js';
import { TriggerParamFields } from './trigger-param-fields.js';
import type { TriggerParams } from './trigger-param-fields.js';

export interface TriggerGroupFormData {
  id: string;
  label: string;
  conditions: { id: string; type: string; description: string; params: TriggerParams }[];
}

export interface StrategyFormData {
  name: string;
  description: string;
  category: string;
  style: string;
  requires: string[];
  content: string;
  triggerGroups: TriggerGroupFormData[];
  tickers: string[];
  maxPositionSize: number | undefined;
  targetWeights: { ticker: string; weight: number }[];
}

interface StrategyFormPanelProps {
  data: StrategyFormData;
  onChange: (data: StrategyFormData) => void;
  editId?: string;
  onSaved: () => void;
}

const TRIGGER_TYPES = [
  'PRICE_MOVE',
  'INDICATOR_THRESHOLD',
  'CONCENTRATION_DRIFT',
  'ALLOCATION_DRIFT',
  'DRAWDOWN',
  'EARNINGS_PROXIMITY',
  'METRIC_THRESHOLD',
  'SIGNAL_PRESENT',
  'PERSON_ACTIVITY',
  'CUSTOM',
];

const CATEGORIES = [
  { value: 'RISK', label: 'Risk' },
  { value: 'PORTFOLIO', label: 'Portfolio' },
  { value: 'MARKET', label: 'Market' },
  { value: 'RESEARCH', label: 'Research' },
];

const STYLES = [
  { value: 'MOMENTUM', label: 'Momentum' },
  { value: 'VALUE', label: 'Value' },
  { value: 'MEAN_REVERSION', label: 'Mean Reversion' },
  { value: 'SWING', label: 'Swing' },
  { value: 'TREND_FOLLOWING', label: 'Trend Following' },
  { value: 'INCOME', label: 'Income' },
  { value: 'GROWTH', label: 'Growth' },
  { value: 'DEFENSIVE', label: 'Defensive' },
  { value: 'CARRY', label: 'Carry' },
  { value: 'EVENT_DRIVEN', label: 'Event Driven' },
  { value: 'QUANT', label: 'Quant' },
  { value: 'RISK', label: 'Risk' },
  { value: 'SENTIMENT', label: 'Sentiment' },
  { value: 'STATISTICAL_ARB', label: 'Statistical Arb' },
  { value: 'TECHNICAL', label: 'Technical' },
  { value: 'GENERAL', label: 'General' },
];

const inputClass =
  'w-full bg-bg-card border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-light';

const labelClass = 'block text-xs font-medium text-text-muted mb-1';

function serializeTargetWeights(rows: { ticker: string; weight: number }[]): string | undefined {
  const cleaned = rows
    .map((r) => ({ ticker: r.ticker.trim().toUpperCase(), weight: r.weight }))
    .filter((r) => r.ticker && Number.isFinite(r.weight) && r.weight > 0);
  if (cleaned.length === 0) return '';
  const record: Record<string, number> = {};
  for (const { ticker, weight } of cleaned) {
    record[ticker] = weight;
  }
  return JSON.stringify(record);
}

const MARKDOWN_PLACEHOLDER = `## Overview
Describe the strategy rationale...

## Entry Criteria
- Condition 1
- Condition 2

## Exit Criteria
- Take profit at...
- Stop loss at...

## Risk Management
Position sizing, max drawdown, etc.`;

export function StrategyFormPanel({ data, onChange, editId, onSaved }: StrategyFormPanelProps) {
  const isEdit = !!editId;
  const [showPreview, setShowPreview] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [tickerRaw, setTickerRaw] = useState(() => data.tickers.join(', '));
  const tickerInputFocused = useRef(false);

  useEffect(() => {
    if (!tickerInputFocused.current) {
      setTickerRaw(data.tickers.join(', '));
    }
  }, [data.tickers]);

  const [, createStrategy] = useCreateStrategy();
  const [, updateStrategy] = useUpdateStrategy();

  const targetWeightSum = data.targetWeights.reduce((acc, r) => acc + (Number.isFinite(r.weight) ? r.weight : 0), 0);
  const targetWeightOverflow = targetWeightSum > 1.0001;
  const saveDisabled =
    saving ||
    !data.name.trim() ||
    !data.content.trim() ||
    data.triggerGroups.every((g) => g.conditions.every((c) => !c.description.trim())) ||
    targetWeightOverflow;

  const hasPartialGroups = data.triggerGroups.some((g) => {
    const filled = g.conditions.filter((c) => c.description.trim());
    return filled.length > 0 && filled.length < g.conditions.length;
  });

  function update(patch: Partial<StrategyFormData>) {
    onChange({ ...data, ...patch });
  }

  function updateCondition(
    groupIndex: number,
    condIndex: number,
    patch: Partial<TriggerGroupFormData['conditions'][number]>,
  ) {
    const updated = data.triggerGroups.map((g, gi) =>
      gi === groupIndex
        ? { ...g, conditions: g.conditions.map((c, ci) => (ci === condIndex ? { ...c, ...patch } : c)) }
        : g,
    );
    update({ triggerGroups: updated });
  }

  function addCondition(groupIndex: number) {
    const updated = data.triggerGroups.map((g, gi) =>
      gi === groupIndex
        ? {
            ...g,
            conditions: [...g.conditions, { id: crypto.randomUUID(), type: 'PRICE_MOVE', description: '', params: {} }],
          }
        : g,
    );
    update({ triggerGroups: updated });
  }

  function removeCondition(groupIndex: number, condIndex: number) {
    const updated = data.triggerGroups
      .map((g, gi) => (gi === groupIndex ? { ...g, conditions: g.conditions.filter((_, ci) => ci !== condIndex) } : g))
      .filter((g) => g.conditions.length > 0);
    update({
      triggerGroups:
        updated.length > 0
          ? updated
          : [
              {
                id: crypto.randomUUID(),
                label: '',
                conditions: [{ id: crypto.randomUUID(), type: 'PRICE_MOVE', description: '', params: {} }],
              },
            ],
    });
  }

  function updateGroupLabel(groupIndex: number, label: string) {
    const updated = data.triggerGroups.map((g, gi) => (gi === groupIndex ? { ...g, label } : g));
    update({ triggerGroups: updated });
  }

  function addGroup() {
    update({
      triggerGroups: [
        ...data.triggerGroups,
        {
          id: crypto.randomUUID(),
          label: '',
          conditions: [{ id: crypto.randomUUID(), type: 'PRICE_MOVE', description: '', params: {} }],
        },
      ],
    });
  }

  function commitTickers() {
    const parsed = tickerRaw
      .split(',')
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);
    update({ tickers: parsed });
    setTickerRaw(parsed.join(', '));
  }

  function updateTargetWeight(index: number, patch: Partial<{ ticker: string; weight: number }>) {
    update({
      targetWeights: data.targetWeights.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    });
  }

  function addTargetWeight() {
    update({ targetWeights: [...data.targetWeights, { ticker: '', weight: 0 }] });
  }

  function removeTargetWeight(index: number) {
    update({ targetWeights: data.targetWeights.filter((_, i) => i !== index) });
  }

  async function handleSave() {
    setError(null);
    setSaving(true);

    try {
      const input = {
        name: data.name.trim(),
        description: data.description.trim() || data.name.trim(),
        category: data.category,
        style: data.style || 'GENERAL',
        content: data.content,
        triggerGroups: data.triggerGroups
          .map((g) => ({
            label: g.label || undefined,
            conditions: g.conditions
              .filter((c) => c.description.trim())
              .map((c) => ({
                type: c.type,
                description: c.description.trim(),
                params: Object.keys(c.params).length > 0 ? JSON.stringify(c.params) : undefined,
              })),
          }))
          .filter((g) => g.conditions.length > 0),
        tickers: data.tickers.length > 0 ? data.tickers : undefined,
        maxPositionSize:
          data.maxPositionSize !== undefined && !isNaN(data.maxPositionSize) ? data.maxPositionSize : undefined,
        targetWeights: serializeTargetWeights(data.targetWeights),
      };

      const result = isEdit ? await updateStrategy({ id: editId, input }) : await createStrategy({ input });

      if (result.error) {
        setError(result.error.message);
        return;
      }

      onSaved();
    } finally {
      setSaving(false);
    }
  }

  // Use Math.max(1, ...) to prevent small non-zero values from rounding to 0 and being cleared
  const posPercent =
    data.maxPositionSize !== undefined && data.maxPositionSize > 0
      ? Math.max(1, Math.round(data.maxPositionSize * 100))
      : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="font-headline text-sm text-text-primary">Strategy</h2>
        <Button size="sm" disabled={saveDisabled} loading={saving} onClick={handleSave}>
          {isEdit ? 'Update' : 'Save'}
        </Button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Name */}
        <div>
          <label className={labelClass}>Name</label>
          <input
            type="text"
            value={data.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="Strategy name"
            className={inputClass}
          />
        </div>

        {/* Tickers */}
        <div>
          <label className={labelClass}>Tickers</label>
          <input
            type="text"
            value={tickerRaw}
            onChange={(e) => setTickerRaw(e.target.value)}
            onFocus={() => {
              tickerInputFocused.current = true;
            }}
            onBlur={() => {
              tickerInputFocused.current = false;
              commitTickers();
            }}
            placeholder="AAPL, NVDA, BTC (comma-separated, or leave empty for all)"
            className={inputClass}
          />
        </div>

        {/* Trigger Groups */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-text-muted">Trigger Groups</label>
            <button
              type="button"
              onClick={addGroup}
              className="text-xs text-accent-primary hover:text-accent-secondary transition-colors cursor-pointer"
            >
              + Add group
            </button>
          </div>
          <div className="space-y-3">
            {data.triggerGroups.map((group, gi) => (
              <div key={group.id}>
                {gi > 0 && (
                  <div className="flex items-center gap-2 py-1">
                    <div className="flex-1 border-t border-border" />
                    <span className="text-xs font-medium text-accent-primary">OR</span>
                    <div className="flex-1 border-t border-border" />
                  </div>
                )}
                <div className="bg-bg-tertiary rounded-lg p-3 space-y-2">
                  <input
                    type="text"
                    value={group.label}
                    onChange={(e) => updateGroupLabel(gi, e.target.value)}
                    placeholder="Group label (optional)"
                    className={cn(inputClass, 'text-xs')}
                  />
                  {group.conditions.map((condition, ci) => (
                    <div key={condition.id}>
                      {ci > 0 && <div className="text-center text-xs font-medium text-text-muted py-0.5">AND</div>}
                      <div className="bg-bg-card rounded-lg p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <select
                            value={condition.type}
                            onChange={(e) => updateCondition(gi, ci, { type: e.target.value, params: {} })}
                            className={cn(inputClass, 'flex-1')}
                          >
                            {TRIGGER_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            aria-label="Remove condition"
                            onClick={() => removeCondition(gi, ci)}
                            className="text-text-muted hover:text-error transition-colors cursor-pointer"
                          >
                            <svg
                              className="h-4 w-4"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                        <input
                          type="text"
                          value={condition.description}
                          onChange={(e) => updateCondition(gi, ci, { description: e.target.value })}
                          placeholder="Condition description"
                          className={inputClass}
                        />
                        <TriggerParamFields
                          type={condition.type}
                          params={condition.params}
                          onChange={(params) => updateCondition(gi, ci, { params })}
                        />
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addCondition(gi)}
                    className="text-xs text-accent-primary hover:text-accent-secondary transition-colors cursor-pointer w-full text-center py-1"
                  >
                    + Add condition
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Advanced Settings */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced((p) => !p)}
            className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors cursor-pointer"
          >
            <svg
              className={cn('h-3 w-3 transition-transform', showAdvanced && 'rotate-90')}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
            </svg>
            Advanced settings
          </button>

          {showAdvanced && (
            <div className="mt-3 space-y-4 border-l-2 border-border pl-4">
              {/* Description */}
              <div>
                <label className={labelClass}>Description</label>
                <input
                  type="text"
                  value={data.description}
                  onChange={(e) => update({ description: e.target.value })}
                  placeholder="Brief description (auto-generated if empty)"
                  className={inputClass}
                />
              </div>

              {/* Category + Style */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Category</label>
                  <select
                    value={data.category}
                    onChange={(e) => update({ category: e.target.value })}
                    className={inputClass}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Style</label>
                  <select value={data.style} onChange={(e) => update({ style: e.target.value })} className={inputClass}>
                    {STYLES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Max Position Size */}
              <div>
                <label className={labelClass}>Max Position Size</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={posPercent}
                    onChange={(e) => {
                      const pct = Number(e.target.value);
                      update({ maxPositionSize: pct > 0 ? pct / 100 : undefined });
                    }}
                    className="flex-1 accent-accent-primary"
                  />
                  <span className="text-xs text-text-muted tabular-nums w-8 text-right">{posPercent}%</span>
                </div>
              </div>

              {/* Target Weights — ETF / basket allocation */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-text-muted">Target Weights</label>
                  <span className={cn('text-xs tabular-nums', targetWeightOverflow ? 'text-error' : 'text-text-muted')}>
                    {(targetWeightSum * 100).toFixed(1)}% / 100%
                  </span>
                </div>
                {data.targetWeights.length > 0 && (
                  <div className="space-y-1.5">
                    {data.targetWeights.map((row, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={row.ticker}
                          onChange={(e) => updateTargetWeight(i, { ticker: e.target.value.toUpperCase() })}
                          placeholder="AAPL"
                          className={cn(inputClass, 'flex-1')}
                        />
                        <div className="relative w-28">
                          <input
                            type="number"
                            value={row.weight > 0 ? +(row.weight * 100).toFixed(2) : ''}
                            onChange={(e) => {
                              const v = e.currentTarget.valueAsNumber;
                              updateTargetWeight(i, {
                                weight: e.target.value === '' || Number.isNaN(v) ? 0 : v / 100,
                              });
                            }}
                            placeholder="0"
                            min={0}
                            max={100}
                            step={0.5}
                            className={cn(inputClass, 'pr-8')}
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-muted pointer-events-none">
                            %
                          </span>
                        </div>
                        <button
                          type="button"
                          aria-label="Remove target weight"
                          onClick={() => removeTargetWeight(i)}
                          className="text-text-muted hover:text-error transition-colors cursor-pointer"
                        >
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={addTargetWeight}
                  className="text-xs text-accent-primary hover:text-accent-secondary transition-colors cursor-pointer mt-1.5"
                >
                  + Add ticker
                </button>
                {targetWeightOverflow && <p className="text-xs text-error mt-1">Target weights sum must be ≤ 100%.</p>}
              </div>

              {/* Content */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-text-muted">Strategy Content</label>
                  <button
                    type="button"
                    onClick={() => setShowPreview((p) => !p)}
                    className="text-xs text-text-muted hover:text-text-primary transition-colors cursor-pointer"
                  >
                    {showPreview ? 'Edit' : 'Preview'}
                  </button>
                </div>
                {showPreview ? (
                  <div className="bg-bg-card border border-border rounded-lg p-4 prose prose-invert prose-sm max-w-none text-text-primary min-h-[300px]">
                    {data.content ? (
                      <ReactMarkdown>{data.content}</ReactMarkdown>
                    ) : (
                      <p className="text-text-muted italic">No content to preview</p>
                    )}
                  </div>
                ) : (
                  <textarea
                    value={data.content}
                    onChange={(e) => update({ content: e.target.value })}
                    placeholder={MARKDOWN_PLACEHOLDER}
                    rows={16}
                    className={cn(inputClass, 'font-mono resize-none min-h-[300px]')}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Error bar */}
      {error && <div className="bg-error/10 border-t border-error/30 px-4 py-3 text-error text-sm">{error}</div>}
      {hasPartialGroups && !error && (
        <p className="text-xs text-warning px-4">Empty conditions will be removed on save.</p>
      )}
    </div>
  );
}
