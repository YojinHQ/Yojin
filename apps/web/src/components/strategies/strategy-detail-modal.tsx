import { useState } from 'react';
import ReactMarkdown from 'react-markdown';

import { useStrategy, useExportStrategy, useDeleteStrategy } from '../../api/hooks/index.js';
import { formatStyle } from './types.js';
import type { StrategyCategory } from './types.js';
import type { BadgeVariant } from '../common/badge.js';
import Modal from '../common/modal.js';
import Button from '../common/button.js';
import Badge from '../common/badge.js';
import Spinner from '../common/spinner.js';
import { StrategyStudio } from './strategy-studio.js';

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

export default function StrategyDetailModal({ open, strategyId, onClose }: StrategyDetailModalProps) {
  const [result] = useStrategy(strategyId);
  const exportStrategy = useExportStrategy();
  const [, deleteStrategy] = useDeleteStrategy();
  const [copying, setCopying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [forking, setForking] = useState(false);
  const [forkKey, setForkKey] = useState(1000); // offset from editorKey to prevent key collisions
  const [error, setError] = useState<string | null>(null);

  const strategy = result.data?.strategy;

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
            <div className="mt-2 flex items-center gap-2">
              <Badge variant={categoryVariant[strategy.category]}>{strategy.category}</Badge>
              <Badge variant="neutral">{formatStyle(strategy.style)}</Badge>
            </div>
          </div>

          {/* Triggers */}
          {strategy.triggers.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">Triggers</h3>
              <div className="space-y-1.5">
                {strategy.triggers.map((trigger, i) => (
                  <div key={i} className="rounded-lg bg-bg-tertiary px-3 py-2 text-sm">
                    <span className="font-medium text-text-primary">{trigger.type}</span>
                    <span className="ml-2 text-text-secondary">{trigger.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Required Capabilities */}
          {strategy.requires.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
                Required Capabilities
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {strategy.requires.map((cap) => (
                  <Badge key={cap} variant="accent" size="sm">
                    {cap}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Strategy Content */}
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">Strategy</h3>
            <div className="max-h-[300px] overflow-y-auto rounded-lg bg-bg-tertiary p-4 prose prose-invert prose-sm max-w-none">
              <ReactMarkdown>{strategy.content}</ReactMarkdown>
            </div>
          </div>

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
