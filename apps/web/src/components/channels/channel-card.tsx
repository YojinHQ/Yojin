import { useState } from 'react';

import type { Channel, ChannelStatus } from '../../api/types';
import type { BadgeVariant } from '../common/badge';
import Badge from '../common/badge';
import Button from '../common/button';
import Modal from '../common/modal';
import { cn } from '../../lib/utils';
import { getChannelMeta } from './channel-meta';

interface ChannelCardProps {
  channel: Channel;
  onConnect: (channelId: string) => void;
  onDisconnect: (channelId: string) => void | Promise<void>;
  disconnecting?: boolean;
}

const statusConfig: Record<ChannelStatus, { variant: BadgeVariant; label: string }> = {
  CONNECTED: { variant: 'success', label: 'Connected' },
  NOT_CONNECTED: { variant: 'neutral', label: 'Not Connected' },
  ERROR: { variant: 'error', label: 'Error' },
};

export function ChannelCard({ channel, onConnect, onDisconnect, disconnecting = false }: ChannelCardProps) {
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const meta = getChannelMeta(channel.id);
  const { variant, label } = statusConfig[channel.status];
  const isConnected = channel.status === 'CONNECTED';
  const isWeb = channel.id === 'web';

  return (
    <>
      <div className="flex items-center gap-4 rounded-xl border border-border bg-bg-card p-4">
        <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold', meta.color)}>
          {meta.logo ? <img src={meta.logo} alt={meta.label} className="h-6 w-6 object-contain" /> : meta.initials}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary">{meta.label}</span>
            <Badge variant={variant} size="xs">
              {label}
            </Badge>
          </div>
          {channel.status === 'ERROR' && channel.statusMessage ? (
            <p className="mt-0.5 text-xs text-error">{channel.statusMessage}</p>
          ) : (
            <p className="mt-0.5 text-xs text-text-muted">{meta.description}</p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!isConnected && !isWeb && (
            <Button variant="secondary" size="sm" onClick={() => onConnect(channel.id)}>
              Connect
            </Button>
          )}
          {isConnected && !isWeb && (
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
          This will remove your {meta.label} credentials from the vault and stop sending notifications.
        </p>
        <p className="text-sm text-text-muted mb-6">You can reconnect at any time.</p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" size="sm" onClick={() => setConfirmDisconnect(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={disconnecting}
            onClick={async () => {
              await onDisconnect(channel.id);
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
