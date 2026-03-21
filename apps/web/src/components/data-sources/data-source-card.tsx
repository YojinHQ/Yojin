import { useState } from 'react';

import type { DataSource, DataSourceStatus } from '../../api/types';
import type { BadgeVariant } from '../common/badge';
import Badge from '../common/badge';
import Button from '../common/button';
import Modal from '../common/modal';
import Spinner from '../common/spinner';

interface DataSourceCardProps {
  source: DataSource;
  onToggle: (id: string, enabled: boolean) => void | Promise<void>;
  onRemove: (id: string) => void | Promise<void>;
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
  toggling = false,
  removing = false,
}: DataSourceCardProps) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { variant, label } = statusConfig[source.status];

  return (
    <>
      <div className="flex items-center gap-4 rounded-xl border border-border bg-bg-card p-4">
        {/* Icon */}
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-primary/10 text-accent-primary shrink-0">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75"
            />
          </svg>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary">{source.name}</span>
            <Badge variant={variant} size="xs">
              {label}
            </Badge>
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
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onToggle(source.id, !source.enabled)}
            disabled={toggling}
          >
            {toggling ? <Spinner size="sm" className="text-current" /> : source.enabled ? 'Disable' : 'Enable'}
          </Button>
          <Button variant="ghost" size="sm" aria-label={`Remove ${source.name}`} onClick={() => setConfirmRemove(true)}>
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
        </div>
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
