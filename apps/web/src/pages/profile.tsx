import { useState } from 'react';

import Card from '../components/common/card';
import Spinner from '../components/common/spinner';
import Button from '../components/common/button';
import Badge from '../components/common/badge';
import { PlatformCard } from '../components/platforms/platform-card';
import { AddPlatformModal } from '../components/platforms/add-platform-modal';
import { useListConnections, useDisconnectPlatform, useRefreshPositions, useDeviceInfo } from '../api/hooks';

export default function Profile() {
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addModalKey, setAddModalKey] = useState(0);
  const [syncingPlatform, setSyncingPlatform] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<{ platform: string; success: boolean; error?: string } | null>(null);
  const [disconnectingPlatform, setDisconnectingPlatform] = useState<string | null>(null);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const [{ data: deviceData, fetching: deviceFetching }] = useDeviceInfo();
  const [{ data, fetching, error }] = useListConnections();
  const [, disconnectPlatform] = useDisconnectPlatform();
  const [, refreshPositions] = useRefreshPositions();

  function openAddModal() {
    setAddModalKey((k: number) => k + 1);
    setAddModalOpen(true);
  }

  const device = deviceData?.deviceInfo;
  const connections = data?.listConnections ?? [];
  const connectedPlatforms = connections.map((c) => c.platform);

  async function handleSyncNow(platform: string) {
    setSyncingPlatform(platform);
    setSyncResult(null);
    try {
      const result = await refreshPositions({ platform });
      if (result.error) {
        setSyncResult({ platform, success: false, error: result.error.message });
      } else {
        setSyncResult({ platform, success: true });
        // Auto-dismiss success after 3 seconds
        setTimeout(() => setSyncResult(null), 3000);
      }
    } catch {
      setSyncResult({ platform, success: false, error: 'Sync failed' });
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

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      {/* Device Identity */}
      <Card className="p-6">
        {deviceFetching ? (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        ) : device ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-primary/15">
                <svg
                  className="h-5 w-5 text-accent-primary"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25A2.25 2.25 0 0 1 5.25 3h13.5A2.25 2.25 0 0 1 21 5.25Z"
                  />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-text-primary">This Device</p>
                <p className="text-xs text-text-muted font-mono">
                  {device.deviceId.slice(0, 16)}...{device.deviceId.slice(-8)}
                </p>
              </div>
            </div>
            <div className="text-right">
              <Badge variant="success" size="xs">
                Active
              </Badge>
              <p className="text-2xs text-text-muted mt-1">Since {new Date(device.createdAt).toLocaleDateString()}</p>
            </div>
          </div>
        ) : null}
      </Card>

      {/* Connected Platforms */}
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
            {syncResult && (
              <p
                className={`text-sm rounded-lg px-3 py-2 ${syncResult.success ? 'text-success bg-success/10' : 'text-error bg-error/10'}`}
              >
                {syncResult.success ? `Synced ${syncResult.platform} successfully` : `Sync failed: ${syncResult.error}`}
              </p>
            )}
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
        connectedPlatforms={connectedPlatforms}
      />
    </div>
  );
}
