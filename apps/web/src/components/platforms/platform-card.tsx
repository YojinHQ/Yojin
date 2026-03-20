import { useState } from 'react';

import type { Connection, ConnectionStatus } from '../../api/types';
import type { BadgeVariant } from '../common/badge';
import Badge from '../common/badge';
import Button from '../common/button';
import Modal from '../common/modal';
import Spinner from '../common/spinner';
import { getPlatformMeta } from './platform-meta';
import { PlatformLogo } from './platform-logos';

interface PlatformCardProps {
  connection: Connection;
  onSyncNow: (platform: string) => void;
  onDisconnect: (platform: string) => void | Promise<void>;
  syncing?: boolean;
  disconnecting?: boolean;
}

const statusConfig: Record<ConnectionStatus, { variant: BadgeVariant; label: string }> = {
  CONNECTED: { variant: 'success', label: 'Connected' },
  PENDING: { variant: 'warning', label: 'Pending' },
  VALIDATING: { variant: 'warning', label: 'Validating' },
  ERROR: { variant: 'error', label: 'Error' },
  DISCONNECTED: { variant: 'neutral', label: 'Disconnected' },
};

function formatLastSync(lastSync: string | null): string {
  if (!lastSync) return 'Never synced';
  const ts = new Date(lastSync).getTime();
  if (isNaN(ts)) return 'Never synced';
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function PlatformCard({
  connection,
  onSyncNow,
  onDisconnect,
  syncing = false,
  disconnecting = false,
}: PlatformCardProps) {
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const meta = getPlatformMeta(connection.platform);
  const { variant, label } = statusConfig[connection.status];
  const isConnected = connection.status === 'CONNECTED';
  const isDisconnected = connection.status === 'DISCONNECTED';

  return (
    <>
      <div className="flex items-center gap-4 rounded-xl border border-border bg-bg-card p-4">
        <PlatformLogo platform={connection.platform} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary">{meta.label}</span>
            <Badge variant={variant} size="xs">
              {label}
            </Badge>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
            <span className="capitalize">{connection.tier.toLowerCase()}</span>
            <span>&middot;</span>
            <span>Synced {formatLastSync(connection.lastSync)}</span>
          </div>
          {connection.lastError && <p className="mt-1 text-xs text-error truncate">{connection.lastError}</p>}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isConnected && (
            <Button variant="secondary" size="sm" onClick={() => onSyncNow(connection.platform)} disabled={syncing}>
              {syncing ? <Spinner size="sm" className="text-current" /> : 'Sync Now'}
            </Button>
          )}
          {!isDisconnected && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Disconnect ${meta.label}`}
              onClick={() => setConfirmDisconnect(true)}
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

      <Modal open={confirmDisconnect} onClose={() => setConfirmDisconnect(false)} title={`Disconnect ${meta.label}?`}>
        <p className="text-sm text-text-secondary mb-2">
          This will remove all cached session data and stop syncing positions from {meta.label}.
        </p>
        <p className="text-sm text-text-muted mb-6">Your position history will be preserved in snapshots.</p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" size="sm" onClick={() => setConfirmDisconnect(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={disconnecting}
            onClick={async () => {
              await onDisconnect(connection.platform);
              setConfirmDisconnect(false);
            }}
          >
            Disconnect
          </Button>
        </div>
      </Modal>
    </>
  );
}
