import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';

import Button from '../common/button.js';
import { useCreateStrategy, useUpdateStrategy } from '../../api/hooks/index.js';
import { cn } from '../../lib/utils.js';
import { TriggerParamFields } from './trigger-param-fields.js';
import type { TriggerParams } from './trigger-param-fields.js';

export interface StrategyFormData {
  name: string;
  description: string;
  category: string;
  style: string;
  requires: string[];
  content: string;
  triggers: { type: string; description: string; params: TriggerParams }[];
  tickers: string[];
  maxPositionSize: number | undefined;
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
  'DRAWDOWN',
  'EARNINGS_PROXIMITY',
  'METRIC_THRESHOLD',
  'SIGNAL_PRESENT',
  'CUSTOM',
];

const CAPABILITIES = [
  { value: 'MARKET_DATA', label: 'Market Data' },
  { value: 'TECHNICALS', label: 'Technicals' },
  { value: 'NEWS', label: 'News' },
  { value: 'RESEARCH', label: 'Research' },
  { value: 'SENTIMENT', label: 'Sentiment' },
  { value: 'FUNDAMENTALS', label: 'Fundamentals' },
  { value: 'FILINGS', label: 'Filings' },
  { value: 'DERIVATIVES', label: 'Derivatives' },
  { value: 'PORTFOLIO', label: 'Portfolio' },
  { value: 'MACRO_DATA', label: 'Macro Data' },
];

const CATEGORIES = [
  { value: 'RISK', label: 'Risk' },
  { value: 'PORTFOLIO', label: 'Portfolio' },
  { value: 'MARKET', label: 'Market' },
  { value: 'RESEARCH', label: 'Research' },
];

const inputClass =
  'w-full bg-bg-card border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-light';

const labelClass = 'block text-xs font-medium text-text-muted mb-1';

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
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [tickerRaw, setTickerRaw] = useState(() => data.tickers.join(', '));
  const tickerInputFocused = useRef(false);

  const [triggerIds, setTriggerIds] = useState<string[]>(() => data.triggers.map(() => crypto.randomUUID()));
  useEffect(() => {
    setTriggerIds((prev) => {
      if (prev.length === data.triggers.length) return prev;
      if (data.triggers.length > prev.length) {
        return [...prev, ...Array.from({ length: data.triggers.length - prev.length }, () => crypto.randomUUID())];
      }
      return prev.slice(0, data.triggers.length);
    });
  }, [data.triggers.length]);

  useEffect(() => {
    if (!tickerInputFocused.current) {
      setTickerRaw(data.tickers.join(', '));
    }
  }, [data.tickers]);

  const [, createStrategy] = useCreateStrategy();
  const [, updateStrategy] = useUpdateStrategy();

  const saveDisabled =
    saving ||
    !data.name.trim() ||
    !data.description.trim() ||
    !data.content.trim() ||
    !data.style.trim() ||
    data.triggers.every((t) => !t.description.trim());

  function update(patch: Partial<StrategyFormData>) {
    onChange({ ...data, ...patch });
  }

  function updateTrigger(index: number, patch: Partial<StrategyFormData['triggers'][number]>) {
    const updated = data.triggers.map((t, i) => (i === index ? { ...t, ...patch } : t));
    update({ triggers: updated });
  }

  function addTrigger() {
    setTriggerIds((prev) => [...prev, crypto.randomUUID()]);
    update({ triggers: [...data.triggers, { type: 'PRICE_MOVE', description: '', params: {} }] });
  }

  function removeTrigger(index: number) {
    setTriggerIds((prev) => prev.filter((_, i) => i !== index));
    update({ triggers: data.triggers.filter((_, i) => i !== index) });
  }

  function toggleCapability(value: string) {
    const next = data.requires.includes(value) ? data.requires.filter((v) => v !== value) : [...data.requires, value];
    update({ requires: next });
  }

  function commitTickers() {
    const parsed = tickerRaw
      .split(',')
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);
    update({ tickers: parsed });
    setTickerRaw(parsed.join(', '));
  }

  async function handleSave() {
    setError(null);
    setSaving(true);

    try {
      const input = {
        name: data.name.trim(),
        description: data.description.trim(),
        category: data.category,
        style: data.style.trim(),
        requires: data.requires.length > 0 ? data.requires : undefined,
        content: data.content,
        triggers: data.triggers
          .filter((t) => t.description.trim())
          .map((t) => ({
            type: t.type,
            description: t.description.trim(),
            params: Object.keys(t.params).length > 0 ? JSON.stringify(t.params) : undefined,
          })),
        tickers: data.tickers.length > 0 ? data.tickers : undefined,
        maxPositionSize:
          data.maxPositionSize !== undefined && !isNaN(data.maxPositionSize) ? data.maxPositionSize : undefined,
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
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowPreview((p) => !p)}
            className="text-xs text-text-muted hover:text-text-primary transition-colors cursor-pointer"
          >
            {showPreview ? 'Edit Content' : 'Preview Content'}
          </button>
          <Button size="sm" disabled={saveDisabled} loading={saving} onClick={handleSave}>
            {isEdit ? 'Update' : 'Save'}
          </Button>
        </div>
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

        {/* Description */}
        <div>
          <label className={labelClass}>Description</label>
          <input
            type="text"
            value={data.description}
            onChange={(e) => update({ description: e.target.value })}
            placeholder="Brief description"
            className={inputClass}
          />
        </div>

        {/* Category + Style */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Category</label>
            <select value={data.category} onChange={(e) => update({ category: e.target.value })} className={inputClass}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Style</label>
            <input
              type="text"
              value={data.style}
              onChange={(e) => update({ style: e.target.value })}
              placeholder="e.g. momentum, mean_reversion"
              className={inputClass}
            />
          </div>
        </div>

        {/* Triggers */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-text-muted">Triggers</label>
            <button
              type="button"
              onClick={addTrigger}
              className="text-xs text-accent-primary hover:text-accent-secondary transition-colors cursor-pointer"
            >
              + Add trigger
            </button>
          </div>
          <div className="space-y-2">
            {data.triggers.map((trigger, i) => (
              <div key={triggerIds[i] ?? i} className="bg-bg-tertiary rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <select
                    value={trigger.type}
                    onChange={(e) => updateTrigger(i, { type: e.target.value, params: {} })}
                    className={cn(inputClass, 'flex-1')}
                  >
                    {TRIGGER_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  {data.triggers.length > 1 && (
                    <button
                      type="button"
                      aria-label="Remove trigger"
                      onClick={() => removeTrigger(i)}
                      className="text-text-muted hover:text-error transition-colors cursor-pointer"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={trigger.description}
                  onChange={(e) => updateTrigger(i, { description: e.target.value })}
                  placeholder="Trigger description"
                  className={inputClass}
                />
                <TriggerParamFields
                  type={trigger.type}
                  params={trigger.params}
                  onChange={(params) => updateTrigger(i, { params })}
                />
              </div>
            ))}
          </div>
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
            placeholder="AAPL, NVDA, BTC (comma-separated)"
            className={inputClass}
          />
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

        {/* Required Capabilities */}
        <div>
          <label className={labelClass}>Required Capabilities</label>
          <div className="flex flex-wrap gap-1.5">
            {CAPABILITIES.map((cap) => {
              const selected = data.requires.includes(cap.value);
              return (
                <button
                  key={cap.value}
                  type="button"
                  onClick={() => toggleCapability(cap.value)}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-xs border transition-colors cursor-pointer',
                    selected
                      ? 'bg-accent-primary/20 text-accent-primary border-accent-primary/40'
                      : 'bg-bg-tertiary text-text-muted border-border hover:border-border-light',
                  )}
                >
                  {cap.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div>
          <label className={labelClass}>Content</label>
          {showPreview ? (
            <div className="bg-bg-card border border-border rounded-lg p-4 prose prose-invert prose-sm max-w-none text-text-primary min-h-[500px]">
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
              rows={24}
              className={cn(inputClass, 'font-mono resize-none min-h-[500px]')}
            />
          )}
        </div>
      </div>

      {/* Error bar */}
      {error && <div className="bg-error/10 border-t border-error/30 px-4 py-3 text-error text-sm">{error}</div>}
    </div>
  );
}
