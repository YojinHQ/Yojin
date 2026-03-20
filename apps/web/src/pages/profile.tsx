import { useState } from 'react';

import Card from '../components/common/card';
import Spinner from '../components/common/spinner';
import Button from '../components/common/button';
import { PlatformCard } from '../components/platforms/platform-card';
import { AddPlatformModal } from '../components/platforms/add-platform-modal';
import {
  useListConnections,
  useConnectPlatform,
  useDisconnectPlatform,
  useRefreshPositions,
  useOnConnectionStatus,
} from '../api/hooks';

export default function Profile() {
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addModalKey, setAddModalKey] = useState(0);
  const [syncingPlatform, setSyncingPlatform] = useState<string | null>(null);
  const [disconnectingPlatform, setDisconnectingPlatform] = useState<string | null>(null);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [connectingPlatform, setConnectingPlatform] = useState<string | null>(null);

  const [{ data, fetching, error }] = useListConnections();
  const [{ fetching: connecting }, connectPlatform] = useConnectPlatform();
  const [, disconnectPlatform] = useDisconnectPlatform();
  const [, refreshPositions] = useRefreshPositions();
  const [{ data: connectionStatus }] = useOnConnectionStatus(connectingPlatform ?? '');

  function openAddModal() {
    setAddModalKey((k) => k + 1);
    setAddModalOpen(true);
  }

  const connections = data?.listConnections ?? [];
  const connectedPlatforms = connections.map((c) => c.platform);

  async function handleSyncNow(platform: string) {
    setSyncingPlatform(platform);
    try {
      await refreshPositions({ platform });
    } finally {
      setSyncingPlatform(null);
    }
  }

  async function handleDisconnect(platform: string) {
    setDisconnectingPlatform(platform);
    setDisconnectError(null);
    try {
      const result = await disconnectPlatform({ platform, removeCredentials: true });
      if (result.error || !result.data?.disconnectPlatform.success) {
        setDisconnectError(result.data?.disconnectPlatform.error ?? result.error?.message ?? 'Disconnect failed');
      }
    } finally {
      setDisconnectingPlatform(null);
    }
  }

  async function handleConnect(platform: string) {
    setConnectingPlatform(platform);
    try {
      const result = await connectPlatform({ input: { platform } });
      if (!result.error && result.data?.connectPlatform.success) {
        setAddModalOpen(false);
      }
    } finally {
      setConnectingPlatform(null);
    }
  }

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      <Card className="p-6">
        <div className="flex items-center gap-5">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-primary/20 text-xl font-semibold text-accent-primary">
            DS
          </div>
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Dean Shaked</h2>
            <p className="text-sm text-text-muted">@dean</p>
          </div>
        </div>
      </Card>

      <Card title="Account Information" section>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Display Name" value="Dean Shaked" />
          <Field label="Username" value="@dean" />
          <Field label="Email" value="dean@yojin.ai" />
          <Field label="Role" value="Owner" />
        </div>
      </Card>

      <Card title="Connected Platforms" section className="relative">
        <div className="absolute right-5 top-5">
          <Button size="sm" onClick={openAddModal}>
            + Connect New
          </Button>
        </div>

        {fetching ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : error ? (
          <p className="py-8 text-center text-sm text-error">Failed to load connections.</p>
        ) : connections.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <p className="text-sm text-text-muted mb-3">No platforms connected yet.</p>
            <Button size="sm" onClick={openAddModal}>
              Connect your first platform
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {disconnectError && (
              <p className="text-sm text-error bg-error/10 rounded-lg px-3 py-2">{disconnectError}</p>
            )}
            {connections.map((connection) => (
              <PlatformCard
                key={connection.platform}
                connection={connection}
                onSyncNow={handleSyncNow}
                onDisconnect={handleDisconnect}
                syncing={syncingPlatform === connection.platform}
                disconnecting={disconnectingPlatform === connection.platform}
              />
            ))}
          </div>
        )}
      </Card>

      <AddPlatformModal
        key={addModalKey}
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onConnect={handleConnect}
        connecting={connecting}
        connectedPlatforms={connectedPlatforms}
        connectionStatus={connectionStatus?.onConnectionStatus ?? null}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-text-muted mb-1">{label}</p>
      <p className="text-sm text-text-primary">{value}</p>
    </div>
  );
}
