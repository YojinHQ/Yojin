import { useState } from 'react';

import { useListConnections } from '../../api/hooks/use-connections';
import type { Platform } from '../../api/types';
import Badge from '../common/badge';
import Button from '../common/button';
import Card from '../common/card';
import Spinner from '../common/spinner';
import { AddPlatformModal } from '../platforms/add-platform-modal';
import { PlatformLogo } from '../platforms/platform-logos';
import { getPlatformMeta } from '../platforms/platform-meta';

function BriefcaseIcon() {
  return (
    <svg
      className="h-5 w-5 text-accent-primary"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.6}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 0 0 .75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 0 0-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0 1 12 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 0 1-.673-.38m0 0A2.18 2.18 0 0 1 3 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 0 1 3.413-.387m7.5 0V5.25A2.25 2.25 0 0 0 13.5 3h-3a2.25 2.25 0 0 0-2.25 2.25v.894m7.5 0a48.667 48.667 0 0 0-7.5 0M12 12.75h.008v.008H12v-.008Z"
      />
    </svg>
  );
}

function statusBadge(status: string): { label: string; variant: 'success' | 'warning' | 'error' | 'neutral' } {
  switch (status) {
    case 'CONNECTED':
      return { label: 'Connected', variant: 'success' };
    case 'VALIDATING':
    case 'PENDING':
      return { label: status === 'PENDING' ? 'Pending' : 'Validating', variant: 'warning' };
    case 'ERROR':
      return { label: 'Error', variant: 'error' };
    case 'DISCONNECTED':
    default:
      return { label: 'Disconnected', variant: 'neutral' };
  }
}

function formatLastSync(iso: string | null): string {
  if (!iso) return 'Never synced';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function PlatformConnectionsCard() {
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [{ data, fetching }] = useListConnections();

  const connections = data?.listConnections ?? [];
  const connectedPlatforms = connections.map((c) => c.platform as Platform);

  return (
    <>
      <Card className="overflow-hidden p-0">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-primary/10">
              <BriefcaseIcon />
            </div>
            <div>
              <h2 className="font-headline text-lg text-text-primary">Brokerage Connections</h2>
              <p className="text-sm text-text-muted">Link brokerage and exchange accounts to sync positions via API.</p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setAddModalOpen(true)}>
            + Add Platform
          </Button>
        </div>

        {/* Connections list */}
        <div className="border-t border-border">
          {fetching ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : connections.length === 0 ? (
            <p className="px-5 py-5 text-sm text-text-muted">
              No platforms connected yet. Click <strong>Add Platform</strong> to link a brokerage account.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {connections.map((c) => {
                const meta = getPlatformMeta(c.platform as Platform);
                const badge = statusBadge(c.status);
                return (
                  <li key={c.platform} className="flex items-center justify-between gap-3 px-5 py-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <PlatformLogo platform={c.platform as Platform} size="sm" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">{meta.label}</p>
                        <p className="text-2xs text-text-muted truncate">
                          {c.tier} · {formatLastSync(c.lastSync)}
                          {c.lastError ? ` · ${c.lastError}` : ''}
                        </p>
                      </div>
                    </div>
                    <Badge variant={badge.variant} size="sm">
                      {badge.label}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>

      <AddPlatformModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        connectedPlatforms={connectedPlatforms}
      />
    </>
  );
}
