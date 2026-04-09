import { useState } from 'react';
import ReactMarkdown from 'react-markdown';

import Modal from '../common/modal.js';
import Button from '../common/button.js';
import { useCreateSkill, useUpdateSkill } from '../../api/hooks/index.js';
import { cn } from '../../lib/utils.js';
import type { Skill } from './types.js';

interface SkillEditorModalProps {
  open: boolean;
  onClose: () => void;
  /** When provided, editor opens in edit mode with fields pre-filled. */
  skill?: Skill | null;
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

export default function SkillEditorModal({ open, onClose, skill: editSkill }: SkillEditorModalProps) {
  const isEdit = !!editSkill;

  const defaults = {
    name: '',
    description: '',
    category: 'MARKET' as string,
    style: '',
    requires: [] as string[],
    content: '',
    triggers: [{ type: 'PRICE_MOVE', description: '', params: '' }],
    tickers: '',
    maxPositionSize: '',
  };

  const initial = editSkill
    ? {
        name: editSkill.name,
        description: editSkill.description,
        category: editSkill.category,
        style: editSkill.style,
        requires: [...editSkill.requires],
        content: editSkill.content,
        triggers: editSkill.triggers.map((t) => ({
          type: t.type,
          description: t.description,
          params: t.params ?? '',
        })),
        tickers: editSkill.tickers.join(', '),
        maxPositionSize: editSkill.maxPositionSize != null ? String(editSkill.maxPositionSize) : '',
      }
    : defaults;

  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [category, setCategory] = useState(initial.category);
  const [style, setStyle] = useState(initial.style);
  const [requires, setRequires] = useState(initial.requires);
  const [content, setContent] = useState(initial.content);
  const [triggers, setTriggers] = useState(initial.triggers);
  const [tickers, setTickers] = useState(initial.tickers);
  const [maxPositionSize, setMaxPositionSize] = useState(initial.maxPositionSize);
  const [showPreview, setShowPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [, createSkill] = useCreateSkill();
  const [, updateSkill] = useUpdateSkill();

  const saveDisabled =
    saving || !name.trim() || !content.trim() || !style.trim() || triggers.every((t) => !t.description.trim());

  function toggleCapability(value: string) {
    setRequires((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  function addTrigger() {
    setTriggers((prev) => [...prev, { type: 'PRICE_MOVE', description: '', params: '' }]);
  }

  function removeTrigger(index: number) {
    setTriggers((prev) => prev.filter((_, i) => i !== index));
  }

  function updateTrigger(index: number, field: 'type' | 'description' | 'params', value: string) {
    setTriggers((prev) => prev.map((t, i) => (i === index ? { ...t, [field]: value } : t)));
  }

  async function handleSave() {
    setError(null);
    setSaving(true);

    try {
      const tickerList = tickers
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const parsedMaxPos = maxPositionSize ? parseFloat(maxPositionSize) : undefined;

      const input = {
        name: name.trim(),
        description: description.trim(),
        category,
        style: style.trim(),
        requires: requires.length > 0 ? requires : undefined,
        content,
        triggers: triggers
          .filter((t) => t.description.trim())
          .map((t) => ({
            type: t.type,
            description: t.description.trim(),
            params: t.params.trim() || undefined,
          })),
        tickers: tickerList.length > 0 ? tickerList : undefined,
        maxPositionSize: parsedMaxPos !== undefined && !isNaN(parsedMaxPos) ? parsedMaxPos : undefined,
      };

      const result =
        isEdit && editSkill ? await updateSkill({ id: editSkill.id, input }) : await createSkill({ input });

      if (result.error) {
        setError(result.error.message);
        return;
      }

      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-4xl" className="h-[80vh] flex flex-col overflow-hidden p-0">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h2 className="font-headline text-lg text-text-primary">{isEdit ? 'Edit Strategy' : 'Create Strategy'}</h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowPreview((p) => !p)}
            className="text-xs text-text-muted hover:text-text-primary transition-colors cursor-pointer"
          >
            {showPreview ? 'Edit' : 'Preview'}
          </button>
          <Button size="sm" disabled={saveDisabled} loading={saving} onClick={handleSave}>
            Save
          </Button>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors cursor-pointer"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* Left panel — form */}
        <div className="w-1/2 overflow-y-auto border-r border-border p-5 space-y-4">
          {/* Name */}
          <div>
            <label className={labelClass}>Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Strategy name"
              className={inputClass}
            />
          </div>

          {/* Description */}
          <div>
            <label className={labelClass}>Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description"
              className={inputClass}
            />
          </div>

          {/* Category */}
          <div>
            <label className={labelClass}>Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          {/* Style */}
          <div>
            <label className={labelClass}>Style</label>
            <input
              type="text"
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              placeholder="e.g. momentum, mean_reversion"
              className={inputClass}
            />
          </div>

          {/* Required Capabilities */}
          <div>
            <label className={labelClass}>Required Capabilities</label>
            <div className="flex flex-wrap gap-1.5">
              {CAPABILITIES.map((cap) => {
                const selected = requires.includes(cap.value);
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

          {/* Triggers */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-text-muted">Triggers</label>
              <button
                type="button"
                onClick={addTrigger}
                className="text-xs text-accent-primary hover:text-accent-secondary transition-colors cursor-pointer"
              >
                + Add
              </button>
            </div>
            <div className="space-y-2">
              {triggers.map((trigger, i) => (
                <div key={i} className="bg-bg-tertiary rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <select
                      value={trigger.type}
                      onChange={(e) => updateTrigger(i, 'type', e.target.value)}
                      className={cn(inputClass, 'flex-1')}
                    >
                      {TRIGGER_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    {triggers.length > 1 && (
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
                    onChange={(e) => updateTrigger(i, 'description', e.target.value)}
                    placeholder="Trigger description"
                    className={inputClass}
                  />
                  <input
                    type="text"
                    value={trigger.params}
                    onChange={(e) => updateTrigger(i, 'params', e.target.value)}
                    placeholder='Params JSON (e.g. {"threshold": 0.05})'
                    className={inputClass}
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
              value={tickers}
              onChange={(e) => setTickers(e.target.value)}
              placeholder="AAPL, NVDA, BTC (comma-separated)"
              className={inputClass}
            />
          </div>

          {/* Max Position Size */}
          <div>
            <label className={labelClass}>Max Position Size</label>
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={maxPositionSize}
              onChange={(e) => setMaxPositionSize(e.target.value)}
              placeholder="0.0 - 1.0"
              className={inputClass}
            />
          </div>
        </div>

        {/* Right panel — content editor / preview */}
        <div className="w-1/2 flex flex-col min-h-0">
          {showPreview ? (
            <div className="flex-1 overflow-y-auto p-5 prose prose-invert prose-sm max-w-none text-text-primary">
              {content ? (
                <ReactMarkdown>{content}</ReactMarkdown>
              ) : (
                <p className="text-text-muted italic">No content to preview</p>
              )}
            </div>
          ) : (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={MARKDOWN_PLACEHOLDER}
              className="flex-1 bg-bg-primary border-none p-5 text-sm text-text-primary font-mono resize-none focus:outline-none"
            />
          )}
        </div>
      </div>

      {/* Error bar */}
      {error && <div className="bg-error/10 border-t border-error/30 px-6 py-3 text-error text-sm">{error}</div>}
    </Modal>
  );
}
