import { useState, useMemo, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

import {
  useStrategy,
  useExportStrategy,
  useDeleteStrategy,
  useToggleStrategy,
  useUpdateStrategy,
} from '../../api/hooks/index.js';
import { formatStyle } from './types.js';
import type { StrategyCategory } from './types.js';
import type { BadgeVariant } from '../common/badge.js';
import Modal from '../common/modal.js';
import Button from '../common/button.js';
import Badge from '../common/badge.js';
import Spinner from '../common/spinner.js';
import Toggle from '../common/toggle.js';
import { StrategyStudio } from './strategy-studio.js';
import { cn } from '../../lib/utils.js';
import { humanizeTrigger, parseTargetWeights, TRIGGER_TYPE_LABELS } from './trigger-meta.js';

/* ── Section parser ─────────────────────────────────────────────── */

interface ContentSection {
  heading: string;
  body: string;
}

/** Map raw markdown headings to friendly labels */
const FRIENDLY_LABELS: Record<string, string> = {
  thesis: 'How It Works',
  'how it works': 'How It Works',
  'signal construction': 'Signal Construction',
  'entry rules': 'When to Enter',
  'when to enter': 'When to Enter',
  'exit rules': 'When to Exit',
  'when to exit': 'When to Exit',
  'risk controls': 'Risk Controls',
};

/** Icons per section (SVG path data for a 20x20 viewBox) */
const SECTION_ICONS: Record<string, React.ReactNode> = {
  'How It Works': (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
      />
    </svg>
  ),
  'Signal Construction': (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
      />
    </svg>
  ),
  'When to Enter': (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 0 1 0 1.954l-7.108 4.061A1.125 1.125 0 0 1 3 16.811V8.69ZM12.75 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 0 1 0 1.954l-7.108 4.061a1.125 1.125 0 0 1-1.683-.977V8.69Z"
      />
    </svg>
  ),
  'When to Exit': (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9"
      />
    </svg>
  ),
  'Risk Controls': (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
      />
    </svg>
  ),
};

function parseContentSections(content: string): ContentSection[] {
  const sections: ContentSection[] = [];
  // Split on ## headings, keeping the heading text
  const parts = content.split(/^## /m);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const newlineIdx = trimmed.indexOf('\n');
    if (newlineIdx === -1) continue;

    const rawHeading = trimmed.slice(0, newlineIdx).trim();
    // Skip H1 headings (strategy name — already shown in modal title)
    if (rawHeading.startsWith('# ')) continue;

    const body = trimmed.slice(newlineIdx + 1).trim();
    if (!body) continue;

    const heading = FRIENDLY_LABELS[rawHeading.toLowerCase()] ?? rawHeading;
    sections.push({ heading, body });
  }

  return sections;
}

/* ── Collapsible section ────────────────────────────────────────── */

function SectionPanel({ section, defaultOpen }: { section: ContentSection; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const icon = SECTION_ICONS[section.heading];

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex w-full items-center gap-2 px-4 py-3 text-left transition-colors',
          'hover:bg-bg-hover cursor-pointer',
          open ? 'bg-bg-tertiary' : 'bg-bg-card',
        )}
        aria-expanded={open}
      >
        {icon && <span className="text-accent-primary">{icon}</span>}
        <span className="flex-1 text-sm font-medium text-text-primary">{section.heading}</span>
        <svg
          className={cn('h-4 w-4 text-text-muted transition-transform', open && 'rotate-180')}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <div className="strategy-prose px-4 py-3 prose prose-invert prose-sm max-w-none">
          <ReactMarkdown>{section.body}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

/* ── Section header ─────────────────────────────────────────────── */

function SectionLabel({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <h3 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-text-muted">
      <span>{children}</span>
      {count !== undefined && (
        <span className="rounded-full bg-bg-tertiary px-1.5 py-0.5 text-[10px] tabular-nums text-text-muted">
          {count}
        </span>
      )}
    </h3>
  );
}

interface StrategyDetailModalProps {
  open: boolean;
  strategyId: string;
  onClose: () => void;
}

const categoryVariant: Record<StrategyCategory, BadgeVariant> = {
  RISK: 'error',
  PORTFOLIO: 'warning',
  MARKET: 'market',
  RESEARCH: 'success',
};

function formatPercent(fraction: number): string {
  const pct = fraction * 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
}

/* ── Universe editor ─────────────────────────────────────────────── */

interface UniverseRow {
  id: string;
  ticker: string;
  weight: string; // percent string for editing (e.g., "30")
}

function buildInitialRows(tickers: string[], weights: { ticker: string; weight: number }[]): UniverseRow[] {
  const weightMap = new Map(weights.map((w) => [w.ticker.toUpperCase(), w.weight]));
  return tickers.map((t) => {
    const w = weightMap.get(t.toUpperCase());
    return {
      id: crypto.randomUUID(),
      ticker: t,
      weight: w !== undefined ? String(Number((w * 100).toFixed(2))) : '',
    };
  });
}

interface UniverseEditorProps {
  initialTickers: string[];
  initialWeights: { ticker: string; weight: number }[];
  onCancel: () => void;
  onSave: (tickers: string[], targetWeights: string | null) => Promise<void>;
  saving: boolean;
}

function UniverseEditor({ initialTickers, initialWeights, onCancel, onSave, saving }: UniverseEditorProps) {
  const [rows, setRows] = useState<UniverseRow[]>(() => buildInitialRows(initialTickers, initialWeights));

  const totalPercent = useMemo(
    () =>
      rows.reduce((acc, r) => {
        const n = Number(r.weight);
        return acc + (Number.isFinite(n) ? n : 0);
      }, 0),
    [rows],
  );

  function updateRow(id: string, patch: Partial<UniverseRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  function addRow() {
    setRows((prev) => [...prev, { id: crypto.randomUUID(), ticker: '', weight: '' }]);
  }

  async function handleSave() {
    const tickers: string[] = [];
    const weights: Record<string, number> = {};
    let anyWeight = false;
    for (const r of rows) {
      const t = r.ticker.trim().toUpperCase();
      if (!t) continue;
      tickers.push(t);
      const w = Number(r.weight);
      if (r.weight.trim() !== '' && Number.isFinite(w)) {
        weights[t] = w / 100;
        anyWeight = true;
      }
    }
    const targetWeights = anyWeight ? JSON.stringify(weights) : null;
    await onSave(tickers, targetWeights);
  }

  return (
    <div className="rounded-lg border border-border bg-bg-card p-3">
      <div className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-2">
            <input
              type="text"
              value={row.ticker}
              onChange={(e) => updateRow(row.id, { ticker: e.target.value.toUpperCase() })}
              placeholder="TICKER"
              className="flex-1 rounded-md border border-border bg-bg-tertiary px-2 py-1 text-xs font-medium text-text-primary uppercase placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
            />
            <div className="relative w-20">
              <input
                type="number"
                value={row.weight}
                onChange={(e) => updateRow(row.id, { weight: e.target.value })}
                placeholder="—"
                step="0.5"
                min="0"
                max="100"
                className="w-full rounded-md border border-border bg-bg-tertiary px-2 py-1 pr-5 text-xs text-text-primary tabular-nums placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
              />
              <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-text-muted">
                %
              </span>
            </div>
            <button
              type="button"
              onClick={() => removeRow(row.id)}
              aria-label={`Remove ${row.ticker || 'row'}`}
              className="rounded p-1 text-text-muted hover:bg-bg-hover hover:text-error cursor-pointer"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <button type="button" onClick={addRow} className="text-xs text-accent-primary hover:underline cursor-pointer">
          + Add ticker
        </button>
        {totalPercent > 0 && (
          <span
            className={cn(
              'text-[10px] uppercase tracking-wide tabular-nums',
              totalPercent > 100.01 ? 'text-error' : 'text-text-muted',
            )}
          >
            Total {totalPercent % 1 === 0 ? totalPercent : totalPercent.toFixed(1)}%
          </span>
        )}
      </div>

      <div className="mt-3 flex justify-end gap-2 border-t border-border pt-2">
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" loading={saving} onClick={handleSave}>
          Save
        </Button>
      </div>
    </div>
  );
}

export default function StrategyDetailModal({ open, strategyId, onClose }: StrategyDetailModalProps) {
  const [result] = useStrategy(strategyId);
  const exportStrategy = useExportStrategy();
  const [, deleteStrategy] = useDeleteStrategy();
  const [, toggleStrategy] = useToggleStrategy();
  const [, updateStrategy] = useUpdateStrategy();
  const [copying, setCopying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [forking, setForking] = useState(false);
  const [forkKey, setForkKey] = useState(1000); // offset from editorKey to prevent key collisions
  const [error, setError] = useState<string | null>(null);
  const [editingUniverse, setEditingUniverse] = useState(false);
  const [savingUniverse, setSavingUniverse] = useState(false);
  // Optimistic active state — toggleStrategy returns {id, active} which graphcache merges,
  // but local state lets the toggle respond immediately while the mutation is in-flight.
  const [activeOverride, setActiveOverride] = useState<boolean | null>(null);

  const strategy = result.data?.strategy;
  const sections = useMemo(
    () => (strategy?.content ? parseContentSections(strategy.content) : []),
    [strategy?.content],
  );
  const targetWeights = useMemo(() => parseTargetWeights(strategy?.targetWeights), [strategy?.targetWeights]);
  const targetWeightSum = useMemo(
    () => targetWeights.reduce((acc, r) => acc + (Number.isFinite(r.weight) ? r.weight : 0), 0),
    [targetWeights],
  );
  const tickerWeightMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const w of targetWeights) map.set(w.ticker.toUpperCase(), w.weight);
    return map;
  }, [targetWeights]);

  // Reset transient UI when the modal reopens for a different strategy.
  useEffect(() => {
    if (!open) {
      setEditingUniverse(false);
      setActiveOverride(null);
      setError(null);
    }
  }, [open]);

  const isActive = activeOverride ?? strategy?.active ?? false;

  async function handleToggleActive(next: boolean) {
    if (!strategy) return;
    setActiveOverride(next);
    setError(null);
    const res = await toggleStrategy({ id: strategy.id, active: next });
    if (res.error) {
      setActiveOverride(strategy.active);
      setError(res.error.message);
    }
  }

  async function handleSaveUniverse(tickers: string[], targetWeightsJson: string | null) {
    if (!strategy) return;
    setSavingUniverse(true);
    setError(null);
    try {
      const res = await updateStrategy({
        id: strategy.id,
        input: { tickers, targetWeights: targetWeightsJson },
      });
      if (res.error) {
        setError(res.error.message);
        return;
      }
      setEditingUniverse(false);
    } finally {
      setSavingUniverse(false);
    }
  }

  async function handleCopy() {
    setCopying(true);
    setError(null);
    try {
      const res = await exportStrategy({ id: strategyId });
      if (res.error) {
        setError(res.error.message);
        return;
      }
      if (res.data?.exportStrategy) {
        await navigator.clipboard.writeText(res.data.exportStrategy);
      }
    } finally {
      setCopying(false);
    }
  }

  async function handleDownload() {
    setDownloading(true);
    setError(null);
    try {
      const res = await exportStrategy({ id: strategyId });
      if (res.error) {
        setError(res.error.message);
        return;
      }
      if (res.data?.exportStrategy) {
        const blob = new Blob([res.data.exportStrategy], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${strategy?.name ?? 'strategy'}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } finally {
      setDownloading(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      const res = await deleteStrategy({ id: strategyId });
      if (res.error) {
        setError(res.error.message);
        return;
      }
      if (res.data?.deleteStrategy) {
        onClose();
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={strategy?.name ?? 'Strategy Details'} maxWidth="max-w-2xl">
      {result.fetching ? (
        <div className="flex items-center justify-center py-12">
          <Spinner label="Loading strategy…" />
        </div>
      ) : !strategy ? (
        <p className="py-8 text-center text-text-muted">Strategy not found.</p>
      ) : (
        <div className="space-y-5">
          {/* Header */}
          <div>
            <p className="text-sm text-text-secondary">{strategy.description}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-md border border-border bg-bg-card px-2 py-1">
                <Toggle checked={isActive} onChange={handleToggleActive} size="sm" />
                <span className={cn('text-xs font-medium', isActive ? 'text-success' : 'text-text-muted')}>
                  {isActive ? 'Active' : 'Paused'}
                </span>
              </div>
              <Badge variant={categoryVariant[strategy.category]}>{strategy.category}</Badge>
              <Badge variant="neutral">{formatStyle(strategy.style)}</Badge>
            </div>
          </div>

          {/* Settings — allocation + max position */}
          {(strategy.targetAllocation != null || strategy.maxPositionSize != null) && (
            <div className="grid grid-cols-2 gap-2">
              {strategy.targetAllocation != null && (
                <div className="rounded-lg border border-border bg-bg-card px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-text-muted">Target Allocation</div>
                  <div className="mt-0.5 text-lg font-medium text-text-primary tabular-nums">
                    {formatPercent(strategy.targetAllocation)}
                  </div>
                </div>
              )}
              {strategy.maxPositionSize != null && (
                <div className="rounded-lg border border-border bg-bg-card px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-text-muted">Max Position</div>
                  <div className="mt-0.5 text-lg font-medium text-text-primary tabular-nums">
                    {formatPercent(strategy.maxPositionSize)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Universe — tickers + inline weights, with edit mode */}
          {(strategy.tickers.length > 0 || editingUniverse) && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <SectionLabel count={strategy.tickers.length}>Universe</SectionLabel>
                {!editingUniverse && (
                  <button
                    type="button"
                    onClick={() => setEditingUniverse(true)}
                    aria-label="Edit universe"
                    className="rounded p-1 text-text-muted hover:bg-bg-hover hover:text-text-primary cursor-pointer"
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.8}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125"
                      />
                    </svg>
                  </button>
                )}
              </div>

              {editingUniverse ? (
                <UniverseEditor
                  initialTickers={strategy.tickers}
                  initialWeights={targetWeights}
                  onCancel={() => setEditingUniverse(false)}
                  onSave={handleSaveUniverse}
                  saving={savingUniverse}
                />
              ) : (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {strategy.tickers.map((t) => {
                      const w = tickerWeightMap.get(t.toUpperCase());
                      return (
                        <span
                          key={t}
                          className="inline-flex items-center gap-1.5 rounded-md bg-bg-tertiary px-2 py-1 text-xs font-medium text-text-primary tabular-nums"
                        >
                          <span>{t}</span>
                          {w !== undefined && <span className="text-text-muted">{formatPercent(w)}</span>}
                        </span>
                      );
                    })}
                  </div>
                  {targetWeights.length > 0 && (
                    <p
                      className={cn(
                        'mt-1.5 text-[10px] uppercase tracking-wide tabular-nums',
                        targetWeightSum > 1.0001 ? 'text-error' : 'text-text-muted',
                      )}
                    >
                      Total {formatPercent(targetWeightSum)}
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Triggers */}
          {strategy.triggerGroups.length > 0 && (
            <div>
              <SectionLabel>Triggers</SectionLabel>
              <div className="space-y-2">
                {strategy.triggerGroups.map((group, gi) => (
                  <div key={gi}>
                    {gi > 0 && (
                      <div className="flex items-center gap-2 py-1">
                        <div className="flex-1 border-t border-border" />
                        <span className="text-xs font-medium text-accent-primary">OR</span>
                        <div className="flex-1 border-t border-border" />
                      </div>
                    )}
                    <div className="rounded-lg border border-border bg-bg-card px-3 py-2">
                      {group.label && <p className="mb-1 text-xs font-medium text-text-muted">{group.label}</p>}
                      <ul className="space-y-1.5">
                        {group.conditions.map((trigger, ci) => {
                          const sentence = humanizeTrigger(trigger.type, trigger.params, trigger.description);
                          const typeLabel = TRIGGER_TYPE_LABELS[trigger.type] ?? trigger.type;
                          return (
                            <li key={ci} className="flex items-start gap-2 text-sm">
                              {ci > 0 && <span className="mt-0.5 text-xs text-text-muted">AND</span>}
                              <span className="flex-1 text-text-primary">{sentence}</span>
                              <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-muted">
                                {typeLabel}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Required Capabilities */}
          {strategy.requires.length > 0 && (
            <div>
              <SectionLabel>Required Capabilities</SectionLabel>
              <div className="flex flex-wrap gap-1.5">
                {strategy.requires.map((cap) => (
                  <Badge key={cap} variant="accent" size="sm">
                    {cap}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Strategy Content — structured sections */}
          {sections.length > 0 && (
            <div>
              <SectionLabel>Rationale</SectionLabel>
              <div className="space-y-2">
                {sections.map((section) => (
                  <SectionPanel key={section.heading} section={section} defaultOpen={false} />
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between border-t border-border pt-2">
            <Button variant="danger" size="sm" loading={deleting} onClick={handleDelete}>
              Delete
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" loading={copying} onClick={handleCopy}>
                Copy Markdown
              </Button>
              <Button variant="secondary" size="sm" loading={downloading} onClick={handleDownload}>
                Download .md
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setForkKey((k) => k + 1);
                  setForking(true);
                }}
              >
                Fork
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setEditorKey((k) => k + 1);
                  setEditing(true);
                }}
              >
                Edit
              </Button>
            </div>
          </div>

          {error && (
            <div className="bg-error/10 border border-error/30 rounded-lg px-3 py-2 text-error text-sm">{error}</div>
          )}

          <StrategyStudio
            key={editorKey}
            open={editing}
            strategy={strategy}
            editMode
            onClose={() => setEditing(false)}
          />
          <StrategyStudio key={forkKey} open={forking} strategy={strategy} onClose={() => setForking(false)} />
        </div>
      )}
    </Modal>
  );
}

export type { StrategyDetailModalProps };
