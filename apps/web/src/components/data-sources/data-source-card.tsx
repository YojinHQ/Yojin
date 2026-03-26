import { useState } from 'react';

import type { DataSource, DataSourceStatus } from '../../api/types';
import { useChatPanel } from '../../lib/chat-panel-context';
import type { BadgeVariant } from '../common/badge';
import Badge from '../common/badge';
import Button from '../common/button';
import Modal from '../common/modal';
import Spinner from '../common/spinner';

interface DataSourceCardProps {
  source: DataSource;
  onToggle: (id: string, enabled: boolean) => void | Promise<void>;
  onRemove: (id: string) => void | Promise<void>;
  onFetch: (id: string, url?: string) => Promise<{ ingested: number; duplicates: number; error?: string } | null>;
  toggling?: boolean;
  removing?: boolean;
}

const statusConfig: Record<DataSourceStatus, { variant: BadgeVariant; label: string }> = {
  ACTIVE: { variant: 'success', label: 'Active' },
  ERROR: { variant: 'error', label: 'Error' },
  DISABLED: { variant: 'neutral', label: 'Disabled' },
};

const typeLabels: Record<string, string> = {
  CLI: 'CLI Tool',
  MCP: 'MCP Server',
  API: 'REST API',
};

export function DataSourceCard({
  source,
  onToggle,
  onRemove,
  onFetch,
  toggling = false,
  removing = false,
}: DataSourceCardProps) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchResult, setFetchResult] = useState<{ ingested: number; duplicates: number; error?: string } | null>(null);
  const { openChatWith } = useChatPanel();
  const { variant, label } = statusConfig[source.status];

  const isCli = source.type === 'CLI';
  const hasSearchCapability = source.capabilities.some((c) => c.id === 'search' || c.id === 'web-search');

  async function handleFetch() {
    if (hasSearchCapability) {
      openChatWith(`Use ${source.name} to search for relevant data about my portfolio positions.`);
      return;
    }
    setFetching(true);
    setFetchResult(null);
    try {
      const result = await onFetch(source.id);
      setFetchResult(result);
    } finally {
      setFetching(false);
    }
  }

  return (
    <>
      <div className="rounded-xl border border-border bg-bg-card">
        <div className="flex items-center gap-4 p-4">
          {/* Icon */}
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-primary/10 text-accent-primary shrink-0">
            {isCli ? (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m6.75 7.5 3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0 0 21 18V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v12a2.25 2.25 0 0 0 2.25 2.25Z"
                />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375"
                />
              </svg>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text-primary">{source.name}</span>
              <Badge variant={variant} size="xs">
                {label}
              </Badge>
              {source.builtin && (
                <Badge variant="accent" size="xs">
                  Built-in
                </Badge>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
              <span>{typeLabels[source.type] ?? source.type}</span>
              {source.capabilities.length > 0 && (
                <>
                  <span>&middot;</span>
                  <span>{source.capabilities.map((c) => c.id).join(', ')}</span>
                </>
              )}
            </div>
            {source.lastError && <p className="mt-1 text-xs text-error truncate">{source.lastError}</p>}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {source.enabled && (isCli || hasSearchCapability) && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleFetch()}
                disabled={fetching}
                loading={fetching}
              >
                {hasSearchCapability ? 'Search' : fetching ? 'Fetching...' : 'Fetch'}
              </Button>
            )}
            {!source.builtin && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onToggle(source.id, !source.enabled)}
                disabled={toggling}
              >
                {toggling ? <Spinner size="sm" className="text-current" /> : source.enabled ? 'Disable' : 'Enable'}
              </Button>
            )}
            {!source.builtin && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove ${source.name}`}
                onClick={() => setConfirmRemove(true)}
              >
                <svg
                  className="h-4 w-4 text-text-muted"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </Button>
            )}
          </div>
        </div>

        {/* Fetch result */}
        {fetchResult && (
          <div className="border-t border-border px-4 py-3">
            <p className="text-xs text-text-secondary">
              {fetchResult.error ? (
                <span className="text-error">{fetchResult.error}</span>
              ) : fetchResult.ingested > 0 ? (
                <span className="text-success">
                  {fetchResult.ingested} signal{fetchResult.ingested !== 1 ? 's' : ''} ingested
                </span>
              ) : (
                <span className="text-text-muted">No new signals</span>
              )}
              {!fetchResult.error && fetchResult.duplicates > 0 && (
                <span className="text-text-muted">
                  {' '}
                  ({fetchResult.duplicates} duplicate{fetchResult.duplicates !== 1 ? 's' : ''} skipped)
                </span>
              )}
            </p>
          </div>
        )}
      </div>

      <Modal open={confirmRemove} onClose={() => setConfirmRemove(false)} title={`Remove ${source.name}?`}>
        <p className="text-sm text-text-secondary mb-2">
          This will remove the data source configuration. Any credentials stored in the vault will not be affected.
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" size="sm" onClick={() => setConfirmRemove(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={removing}
            onClick={async () => {
              await onRemove(source.id);
              setConfirmRemove(false);
            }}
          >
            Remove
          </Button>
        </div>
      </Modal>
    </>
  );
}
