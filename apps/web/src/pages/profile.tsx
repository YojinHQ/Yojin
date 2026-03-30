import { useCallback, useState } from 'react';
import { useMutation, useQuery } from 'urql';

import Card from '../components/common/card';
import Spinner from '../components/common/spinner';
import Button from '../components/common/button';
import Badge from '../components/common/badge';
import { JintelKeyForm } from '../components/jintel/jintel-key-form';
import { ONBOARDING_STATUS_QUERY, RESET_ONBOARDING_MUTATION } from '../api/documents';
import type { OnboardingStatusQueryResult } from '../api/types';
import { DataSourceCard } from '../components/data-sources/data-source-card';
import { AddDataSourceModal } from '../components/data-sources/add-data-source-modal';
import {
  useListDataSources,
  useRemoveDataSource,
  useToggleDataSource,
  useFetchDataSource,
  useClearAppData,
} from '../api/hooks';
import { useOnboardingStatus } from '../lib/onboarding-context';
import { VaultSection } from './vault';

export default function Profile() {
  const [addDsModalOpen, setAddDsModalOpen] = useState(false);
  const [addDsModalKey, setAddDsModalKey] = useState(0);
  const [togglingDs, setTogglingDs] = useState<string | null>(null);
  const [removingDs, setRemovingDs] = useState<string | null>(null);
  const [dsError, setDsError] = useState<string | null>(null);

  const [clearing, setClearing] = useState(false);
  const [resetting, setResetting] = useState(false);

  const [, clearAppData] = useClearAppData();
  const [{ data: dsData, fetching: dsFetching, error: dsQueryError }, reexecuteDs] = useListDataSources();
  const [, removeDataSource] = useRemoveDataSource();
  const [, toggleDataSource] = useToggleDataSource();
  const [, fetchDataSource] = useFetchDataSource();
  const [{ data: statusData }, reexecuteStatus] = useQuery<OnboardingStatusQueryResult>({
    query: ONBOARDING_STATUS_QUERY,
  });
  const [, resetOnboarding] = useMutation(RESET_ONBOARDING_MUTATION);
  const { openOnboarding, resetOnboardingStatus } = useOnboardingStatus();
  const jintelConfigured = statusData?.onboardingStatus?.jintelConfigured ?? false;

  function openAddDsModal() {
    setAddDsModalKey((k: number) => k + 1);
    setAddDsModalOpen(true);
  }

  const dataSources = [...(dsData?.listDataSources ?? [])]
    .filter((s) => !s.builtin)
    .sort((a, b) => a.priority - b.priority);

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

  const handleResetOnboarding = useCallback(async () => {
    setResetting(true);
    try {
      const result = await resetOnboarding({});
      if (result.error) {
        console.error('Reset onboarding failed:', result.error.message);
      }
      // Clear client state and open modal regardless — the user explicitly
      // asked to reset, so start fresh even if the server cleanup was partial.
      resetOnboardingStatus();
      openOnboarding();
    } finally {
      setResetting(false);
    }
  }, [resetOnboarding, resetOnboardingStatus, openOnboarding]);

  return (
    <div className="flex-1 overflow-auto p-6 space-y-8 max-w-4xl mx-auto w-full">
      {/* ── Section 1: Intelligence Sources ── */}
      <section>
        <Card className="overflow-hidden p-0">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-primary/10">
                <SignalIcon />
              </div>
              <div>
                <h2 className="font-headline text-lg text-text-primary">Intelligence Sources</h2>
                <p className="text-sm text-text-muted">Connect data feeds for portfolio intelligence and signals.</p>
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={openAddDsModal}>
              + Add Source
            </Button>
          </div>

          {/* Jintel — Primary Source */}
          <div className="border-t border-border px-5 py-4 space-y-3">
            <h3 className="text-xs font-medium uppercase tracking-wider text-text-secondary">Primary Source</h3>
            {jintelConfigured ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-primary/10 flex-shrink-0">
                    <BoltIcon />
                  </div>
                  <div>
                    <span className="text-sm font-medium text-text-primary">Jintel Intelligence</span>
                    <p className="text-xs text-text-muted mt-0.5">
                      Real-time quotes, fundamentals, news sentiment, risk screening
                    </p>
                  </div>
                </div>
                <Badge variant="success" size="sm">
                  Connected
                </Badge>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-primary/10 flex-shrink-0">
                    <BoltIcon />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-sm font-medium text-text-primary">Connect Jintel for full intelligence</h4>
                    <p className="text-xs text-text-secondary mt-0.5">
                      Real-time quotes, enriched fundamentals, news sentiment and more.
                    </p>
                  </div>
                </div>
                <JintelKeyForm
                  className="flex-shrink-0"
                  onSuccess={() => reexecuteStatus({ requestPolicy: 'network-only' })}
                />
              </div>
            )}
          </div>

          {/* Custom Data Sources */}
          {dsFetching ? (
            <div className="border-t border-border px-5 py-6 flex justify-center">
              <Spinner />
            </div>
          ) : dsQueryError ? (
            <div className="border-t border-border px-5 py-4">
              <p className="text-sm text-error">Failed to load data sources.</p>
            </div>
          ) : dataSources.length > 0 ? (
            <div className="border-t border-border px-5 py-4 space-y-3">
              <h3 className="text-xs font-medium uppercase tracking-wider text-text-secondary">Custom Sources</h3>
              {dsError && <p className="text-sm text-error bg-error/10 rounded-lg px-3 py-2">{dsError}</p>}
              <div className="space-y-2">
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
            </div>
          ) : null}
        </Card>
      </section>

      <AddDataSourceModal
        key={addDsModalKey}
        open={addDsModalOpen}
        onClose={() => {
          setAddDsModalOpen(false);
          refreshDs();
        }}
      />

      {/* ── Section 2: Credential Vault ── */}
      <section id="vault">
        <VaultSection />
      </section>

      {/* ── Section 3: Danger Zone ── */}
      <section>
        <Card className="border-error/20 overflow-hidden p-0">
          <div className="flex items-center gap-4 px-5 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-error/10">
              <AlertIcon />
            </div>
            <div>
              <h2 className="font-headline text-lg text-text-primary">Danger Zone</h2>
              <p className="text-sm text-text-muted">Irreversible actions that reset or clear your data.</p>
            </div>
          </div>
          <div className="border-t border-error/10">
            <DangerRow
              title="Reset onboarding"
              description="Clear server-side state and restart the onboarding flow"
              actionLabel="Reset"
              confirmLabel="Confirm"
              requireConfirm
              loading={resetting}
              onAction={handleResetOnboarding}
            />
            <div className="border-t border-error/10" />
            <DangerRow
              title="Clear app data"
              description="Removes portfolio, insights, sessions, and brain memory. Vault, config, and device identity are preserved."
              actionLabel="Clear"
              loading={clearing}
              confirmLabel="Confirm"
              requireConfirm
              onAction={async () => {
                setClearing(true);
                try {
                  const result = await clearAppData({});
                  if (result.error || result.data?.clearAppData === false) {
                    setClearing(false);
                    return;
                  }
                  window.location.href = '/';
                } catch {
                  setClearing(false);
                }
              }}
            />
          </div>
        </Card>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Danger Row — consistent destructive-action row used in the Danger Zone
// ---------------------------------------------------------------------------

function DangerRow({
  title,
  description,
  actionLabel,
  confirmLabel,
  loading,
  requireConfirm,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel: string;
  confirmLabel?: string;
  loading: boolean;
  requireConfirm?: boolean;
  onAction: () => void | Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex items-center justify-between px-5 py-4">
      <div className="min-w-0 mr-4">
        <p className="text-sm font-medium text-text-primary">{title}</p>
        <p className="text-xs text-text-muted mt-0.5">{description}</p>
      </div>
      <div className="shrink-0">
        {requireConfirm && confirming ? (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="danger"
              loading={loading}
              onClick={async () => {
                await onAction();
                setConfirming(false);
              }}
            >
              {confirmLabel ?? 'Confirm'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="danger"
            loading={loading}
            onClick={() => {
              if (requireConfirm) {
                setConfirming(true);
              } else {
                onAction();
              }
            }}
          >
            {actionLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section Header Icons
// ---------------------------------------------------------------------------

function SignalIcon() {
  return (
    <svg
      className="h-5 w-5 text-accent-primary"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
      />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg
      className="h-4 w-4 text-accent-primary"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z"
      />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg className="h-5 w-5 text-error" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
      />
    </svg>
  );
}
