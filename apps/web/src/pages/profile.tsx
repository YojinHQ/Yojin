import { useCallback, useState } from 'react';
import { useQuery } from 'urql';

import Card from '../components/common/card';
import Spinner from '../components/common/spinner';
import Button from '../components/common/button';
import Badge from '../components/common/badge';
import { JintelKeyForm } from '../components/jintel/jintel-key-form';
import { ONBOARDING_STATUS_QUERY } from '../api/documents';
import type { OnboardingStatusQueryResult } from '../api/types';
import { DataSourceCard } from '../components/data-sources/data-source-card';
import { AddDataSourceModal } from '../components/data-sources/add-data-source-modal';
import { PlatformCard } from '../components/platforms/platform-card';
import { AddPlatformModal } from '../components/platforms/add-platform-modal';
import {
  useListConnections,
  useDisconnectPlatform,
  useRefreshPositions,
  useDeviceInfo,
  useListDataSources,
  useRemoveDataSource,
  useToggleDataSource,
  useFetchDataSource,
  useClearAppData,
} from '../api/hooks';
import { VaultSection } from './vault';

export default function Profile() {
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addModalKey, setAddModalKey] = useState(0);
  const [syncingPlatform, setSyncingPlatform] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<{ platform: string; success: boolean; error?: string } | null>(null);
  const [disconnectingPlatform, setDisconnectingPlatform] = useState<string | null>(null);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const [addDsModalOpen, setAddDsModalOpen] = useState(false);
  const [addDsModalKey, setAddDsModalKey] = useState(0);
  const [togglingDs, setTogglingDs] = useState<string | null>(null);
  const [removingDs, setRemovingDs] = useState<string | null>(null);
  const [dsError, setDsError] = useState<string | null>(null);

  const [clearConfirm, setClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);

  const [{ data: deviceData, fetching: deviceFetching }] = useDeviceInfo();
  const [{ data, fetching, error }] = useListConnections();
  const [, clearAppData] = useClearAppData();
  const [, disconnectPlatform] = useDisconnectPlatform();
  const [, refreshPositions] = useRefreshPositions();
  const [{ data: dsData, fetching: dsFetching, error: dsQueryError }, reexecuteDs] = useListDataSources();
  const [, removeDataSource] = useRemoveDataSource();
  const [, toggleDataSource] = useToggleDataSource();
  const [, fetchDataSource] = useFetchDataSource();
  const [{ data: statusData }, reexecuteStatus] = useQuery<OnboardingStatusQueryResult>({
    query: ONBOARDING_STATUS_QUERY,
  });
  const jintelConfigured = statusData?.onboardingStatus?.jintelConfigured ?? false;

  function openAddModal() {
    setAddModalKey((k: number) => k + 1);
    setAddModalOpen(true);
  }

  function openAddDsModal() {
    setAddDsModalKey((k: number) => k + 1);
    setAddDsModalOpen(true);
  }

  const device = deviceData?.deviceInfo;
  const connections = data?.listConnections ?? [];
  const connectedPlatforms = connections.map((c) => c.platform);
  const dataSources = [...(dsData?.listDataSources ?? [])].sort((a, b) => {
    if (a.builtin !== b.builtin) return a.builtin ? -1 : 1;
    return a.priority - b.priority;
  });

  const refreshDs = useCallback(() => {
    reexecuteDs({ requestPolicy: 'network-only' });
  }, [reexecuteDs]);

  async function handleToggleDs(id: string, enabled: boolean) {
    setTogglingDs(id);
    setDsError(null);
    try {
      const result = await toggleDataSource({ id, enabled });
      if (result.error || !result.data?.toggleDataSource.success) {
        setDsError(result.data?.toggleDataSource.error ?? result.error?.message ?? 'Toggle failed');
      }
    } finally {
      setTogglingDs(null);
      refreshDs();
    }
  }

  async function handleRemoveDs(id: string) {
    setRemovingDs(id);
    setDsError(null);
    try {
      const result = await removeDataSource({ id });
      if (result.error || !result.data?.removeDataSource.success) {
        setDsError(result.data?.removeDataSource.error ?? result.error?.message ?? 'Remove failed');
      }
    } finally {
      setRemovingDs(null);
      refreshDs();
    }
  }

  async function handleFetchDs(
    id: string,
    url?: string,
  ): Promise<{ ingested: number; duplicates: number; error?: string } | null> {
    const result = await fetchDataSource({ id, url });
    const fetchResult = result.data?.fetchDataSource;
    if (result.error) {
      return { ingested: 0, duplicates: 0, error: result.error.message };
    }
    if (!fetchResult?.success) {
      return { ingested: 0, duplicates: 0, error: fetchResult?.error ?? 'Fetch failed' };
    }
    return {
      ingested: fetchResult.signalsIngested,
      duplicates: fetchResult.duplicates,
    };
  }

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

      {/* Jintel Intelligence */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-headline text-lg text-text-primary">Jintel Intelligence</h2>
        </div>

        <Card>
          {jintelConfigured ? (
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <div className="h-2.5 w-2.5 rounded-full bg-success" />
                <span className="text-sm text-text-primary">Connected</span>
              </div>
              <a href="#vault" className="text-xs text-text-muted hover:text-text-secondary">
                Manage in Vault
              </a>
            </div>
          ) : (
            <div className="space-y-4 p-4">
              <div>
                <h3 className="text-sm font-medium text-text-primary">Connect Jintel for full intelligence features</h3>
                <p className="mt-1 text-xs text-text-secondary">
                  Real-time quotes, enriched fundamentals, news sentiment, and risk screening.
                </p>
              </div>
              <JintelKeyForm onSuccess={() => reexecuteStatus({ requestPolicy: 'network-only' })} />
            </div>
          )}
        </Card>
      </section>

      {/* Data Sources */}
      <Card title="Data Sources" section className="relative">
        <div className="absolute right-5 top-5">
          <Button size="sm" onClick={openAddDsModal}>
            + Add Source
          </Button>
        </div>

        {dsFetching ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : dsQueryError ? (
          <p className="py-8 text-center text-sm text-error">Failed to load data sources.</p>
        ) : dataSources.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <p className="text-sm text-text-muted mb-3">No data sources configured yet.</p>
            <Button size="sm" onClick={openAddDsModal}>
              Add your first data source
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {dsError && <p className="text-sm text-error bg-error/10 rounded-lg px-3 py-2">{dsError}</p>}
            {dataSources.map((source) => (
              <DataSourceCard
                key={source.id}
                source={source}
                onToggle={handleToggleDs}
                onRemove={handleRemoveDs}
                onFetch={handleFetchDs}
                toggling={togglingDs === source.id}
                removing={removingDs === source.id}
              />
            ))}
          </div>
        )}
      </Card>

      <AddDataSourceModal
        key={addDsModalKey}
        open={addDsModalOpen}
        onClose={() => {
          setAddDsModalOpen(false);
          refreshDs();
        }}
      />

      {/* Credential Vault */}
      <VaultSection />

      {/* Danger Zone */}
      <Card className="border border-error/30 p-6">
        <h3 className="text-sm font-medium text-error mb-2">Danger Zone</h3>
        <p className="text-xs text-text-secondary mb-4">
          Clear all app data including portfolio, insights, sessions, and brain memory. Config, audit log, device
          identity, logs, and vault credentials are preserved. This action cannot be undone.
        </p>
        {clearConfirm ? (
          <div className="flex items-center gap-3">
            <span className="text-xs text-text-muted">Are you sure?</span>
            <Button
              size="sm"
              variant="danger"
              disabled={clearing}
              onClick={async () => {
                setClearing(true);
                try {
                  const result = await clearAppData({});
                  if (result.error || result.data?.clearAppData === false) {
                    setClearing(false);
                    setClearConfirm(false);
                    return;
                  }
                  // Hard redirect to bust urql cache
                  window.location.href = '/';
                } catch {
                  setClearing(false);
                  setClearConfirm(false);
                }
              }}
            >
              {clearing ? 'Clearing...' : 'Yes, clear everything'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setClearConfirm(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="danger" onClick={() => setClearConfirm(true)}>
            Clear App Data
          </Button>
        )}
      </Card>
    </div>
  );
}
