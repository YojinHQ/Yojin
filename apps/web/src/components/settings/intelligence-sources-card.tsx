import { useCallback, useState } from 'react';
import { useQuery } from 'urql';
import Card from '../common/card';
import Spinner from '../common/spinner';
import Button from '../common/button';
import Badge from '../common/badge';
import { JintelKeyForm } from '../jintel/jintel-key-form';
import { DataSourceCard } from '../data-sources/data-source-card';
import { AddDataSourceModal } from '../data-sources/add-data-source-modal';
import { ONBOARDING_STATUS_QUERY, VAULT_STATUS_QUERY } from '../../api/documents';
import type { OnboardingStatusQueryResult, VaultStatusQueryResult } from '../../api/types';
import { useListDataSources, useRemoveDataSource, useToggleDataSource, useFetchDataSource } from '../../api/hooks';

export function IntelligenceSourcesCard() {
  const [addDsModalOpen, setAddDsModalOpen] = useState(false);
  const [addDsModalKey, setAddDsModalKey] = useState(0);
  const [togglingDs, setTogglingDs] = useState<string | null>(null);
  const [removingDs, setRemovingDs] = useState<string | null>(null);
  const [dsError, setDsError] = useState<string | null>(null);

  const [{ data: dsData, fetching: dsFetching, error: dsQueryError }, reexecuteDs] = useListDataSources();
  const [, removeDataSource] = useRemoveDataSource();
  const [, toggleDataSource] = useToggleDataSource();
  const [, fetchDataSource] = useFetchDataSource();
  const [{ data: statusData }, reexecuteStatus] = useQuery<OnboardingStatusQueryResult>({
    query: ONBOARDING_STATUS_QUERY,
  });
  const [{ data: vaultData }] = useQuery<VaultStatusQueryResult>({ query: VAULT_STATUS_QUERY });
  const vaultLocked = vaultData ? !vaultData.vaultStatus.isUnlocked : false;
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

  return (
    <>
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
          ) : vaultLocked ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-primary/10 flex-shrink-0">
                  <BoltIcon />
                </div>
                <div>
                  <span className="text-sm font-medium text-text-primary">Jintel Intelligence</span>
                  <p className="text-xs text-warning mt-0.5">Unlock the vault to check connection status.</p>
                </div>
              </div>
              <Badge variant="warning" size="sm">
                Vault Locked
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

      <AddDataSourceModal
        key={addDsModalKey}
        open={addDsModalOpen}
        onClose={() => {
          setAddDsModalOpen(false);
          refreshDs();
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Icons
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
