import { useState } from 'react';

import { cn } from '../../lib/utils';
import type { Platform, ConnectionEvent } from '../../api/types';
import { KNOWN_PLATFORMS } from '../../api/types';
import { useDetectAvailableTiers } from '../../api/hooks';
import Button from '../common/button';
import Modal from '../common/modal';
import Spinner from '../common/spinner';
import { getPlatformMeta } from './platform-meta';
import { PlatformLogo } from './platform-logos';

interface AddPlatformModalProps {
  open: boolean;
  onClose: () => void;
  onConnect: (platform: Platform) => void;
  connecting?: boolean;
  /** Platforms already connected — hidden from the selector. */
  connectedPlatforms: readonly Platform[];
  /** Real-time connection status events from subscription. */
  connectionStatus?: ConnectionEvent | null;
}

/** Platforms shown in the Add modal (exclude MANUAL — that's for CSV upload). */
const CONNECTABLE_PLATFORMS = KNOWN_PLATFORMS.filter((p) => p !== 'MANUAL');

export function AddPlatformModal({
  open,
  onClose,
  onConnect,
  connecting = false,
  connectedPlatforms,
  connectionStatus = null,
}: AddPlatformModalProps) {
  const [selected, setSelected] = useState<Platform | null>(null);
  const [{ data: tierData, fetching: tierFetching }] = useDetectAvailableTiers(selected ?? '');

  const available = CONNECTABLE_PLATFORMS.filter((p) => !connectedPlatforms.includes(p));

  function handleClose() {
    setSelected(null);
    onClose();
  }

  function handleConnect() {
    if (!selected) return;
    onConnect(selected);
  }

  // Phase 1: platform selector grid
  if (!selected) {
    return (
      <Modal open={open} onClose={handleClose} title="Connect Platform" maxWidth="max-w-md">
        <p className="text-sm text-text-muted mb-4">Select your investment platform:</p>

        {available.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-8">All supported platforms are already connected.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {available.map((platform) => {
              const meta = getPlatformMeta(platform);
              return (
                <button
                  key={platform}
                  onClick={() => setSelected(platform)}
                  className={cn(
                    'flex flex-col items-center gap-2 rounded-xl border border-border p-4',
                    'hover:border-accent-primary/50 hover:bg-bg-hover transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/30',
                  )}
                >
                  <PlatformLogo platform={platform} size="lg" />
                  <span className="text-sm font-medium text-text-primary">{meta.label}</span>
                  <span className="text-2xs text-text-muted">{meta.description}</span>
                </button>
              );
            })}
          </div>
        )}
      </Modal>
    );
  }

  // Phase 2: platform-specific instructions + tier detection
  const meta = getPlatformMeta(selected);
  const tiers = tierData?.detectAvailableTiers ?? [];
  const missingCredentials = tiers.filter((t) => t.available && t.requiresCredentials.length > 0);

  return (
    <Modal open={open} onClose={handleClose} title={`Connect ${meta.label}`} maxWidth="max-w-sm">
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">Yojin will connect to {meta.label} and import your positions.</p>

        {tierFetching ? (
          <div className="flex justify-center py-2">
            <Spinner size="sm" />
          </div>
        ) : (
          missingCredentials.length > 0 && (
            <div className="rounded-lg bg-warning/10 px-3 py-2">
              <p className="text-xs text-warning">
                Requires credentials: {missingCredentials.flatMap((t) => t.requiresCredentials).join(', ')}
              </p>
            </div>
          )
        )}

        <div className="space-y-2">
          <InfoRow text="Your credentials are encrypted and never stored in plaintext." />
          <InfoRow text="Only position data is read — no trades are executed." />
        </div>

        {connecting && connectionStatus && (
          <div className="rounded-lg bg-bg-tertiary/50 px-3 py-2">
            <p className="text-xs text-text-secondary">{connectionStatus.message}</p>
            {connectionStatus.error && <p className="mt-1 text-xs text-error">{connectionStatus.error}</p>}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" size="sm" onClick={handleClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleConnect} loading={connecting}>
            Start Import
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function InfoRow({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-bg-tertiary/50 px-3 py-2">
      <svg
        className="mt-0.5 h-4 w-4 shrink-0 text-info"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
        />
      </svg>
      <span className="text-xs text-text-muted">{text}</span>
    </div>
  );
}
