import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';

import Button from '../common/button.js';
import Toggle from '../common/toggle.js';
import Spinner from '../common/spinner.js';
import {
  useStrategySources,
  useAddStrategySource,
  useRemoveStrategySource,
  useToggleStrategySource,
  useSyncStrategies,
} from '../../api/hooks/use-skills.js';
import type { StrategySource } from '../../api/types.js';
import { cn, timeAgo } from '../../lib/utils.js';

const DEFAULT_SOURCE_ID = 'YojinHQ/trading-strategies';

function SourceRow({
  source,
  onToggle,
  onRemove,
}: {
  source: StrategySource;
  onToggle: (id: string, enabled: boolean) => void;
  onRemove: (id: string) => void;
}) {
  const isDefault = source.id === DEFAULT_SOURCE_ID;
  const displayName = source.label ?? `${source.owner}/${source.repo}`;

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-bg-secondary px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-text-primary">{displayName}</span>
          {isDefault && (
            <span className="shrink-0 rounded bg-accent-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent-primary">
              Default
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-text-muted">
          {source.owner}/{source.repo}/{source.path} &middot;{' '}
          {source.lastSyncedAt ? timeAgo(source.lastSyncedAt) : 'Never'}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <Toggle checked={source.enabled} onChange={(checked) => onToggle(source.id, checked)} />

        {!isDefault && (
          <button
            type="button"
            aria-label={`Remove ${displayName}`}
            className="rounded p-1 text-text-muted transition-colors hover:bg-bg-hover hover:text-error"
            onClick={() => onRemove(source.id)}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

export function StrategySources() {
  const [result] = useStrategySources();
  const [, addSource] = useAddStrategySource();
  const [, removeSource] = useRemoveStrategySource();
  const [, toggleSource] = useToggleStrategySource();
  const [syncState, syncSources] = useSyncStrategies();

  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [syncToast, setSyncToast] = useState<{ message: string; type: 'success' | 'warning' } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const sources = result.data?.strategySources ?? [];

  async function handleAdd() {
    setError(null);
    const trimmed = url.trim();
    if (!trimmed) return;

    try {
      new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    } catch {
      setError('Invalid URL. Use a GitHub repository URL (e.g. https://github.com/owner/repo).');
      return;
    }

    const res = await addSource({ url: trimmed });
    if (res.error) {
      setError(res.error.message.replace('[GraphQL] ', ''));
    } else {
      setUrl('');
    }
  }

  async function handleToggle(id: string, enabled: boolean) {
    const res = await toggleSource({ id, enabled });
    if (res.error) setError(res.error.message.replace('[GraphQL] ', ''));
  }

  async function handleRemove(id: string) {
    const res = await removeSource({ id });
    if (res.error) setError(res.error.message.replace('[GraphQL] ', ''));
  }

  async function handleSyncAll() {
    const res = await syncSources({});
    if (res.error) return;
    const data = res.data?.syncStrategies;
    if (!data) return;

    if (data.errors.length > 0) {
      showToast(`Synced with ${data.errors.length} error(s): ${data.errors[0]}`, 'warning');
    } else if (data.added > 0) {
      showToast(`Added ${data.added} new ${data.added === 1 ? 'strategy' : 'strategies'}`, 'success');
    } else {
      showToast('All strategies up to date', 'success');
    }
  }

  function showToast(message: string, type: 'success' | 'warning') {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setSyncToast({ message, type });
    toastTimerRef.current = setTimeout(() => {
      setSyncToast(null);
      toastTimerRef.current = null;
    }, 3000);
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-text-primary">Strategy Sources</h2>
        <Button type="button" variant="secondary" size="sm" loading={syncState.fetching} onClick={handleSyncAll}>
          Sync All
        </Button>
      </div>

      {syncToast && (
        <div
          className={cn(
            'mb-3 rounded-lg border px-3 py-2 text-sm',
            syncToast.type === 'warning'
              ? 'border-warning/30 bg-warning/10 text-warning'
              : 'border-success/30 bg-success/10 text-success',
          )}
        >
          {syncToast.message}
        </div>
      )}

      {result.fetching && sources.length === 0 ? (
        <div className="flex items-center justify-center py-10">
          <Spinner label="Loading sources..." />
        </div>
      ) : (
        <div className="space-y-2">
          {sources.map((source) => (
            <SourceRow key={source.id} source={source} onToggle={handleToggle} onRemove={handleRemove} />
          ))}

          {sources.length === 0 && !result.fetching && (
            <p className="py-4 text-center text-sm text-text-muted">No strategy sources configured.</p>
          )}
        </div>
      )}

      <div className="mt-4">
        <div className="flex items-center gap-2">
          <input
            type="url"
            placeholder="https://github.com/owner/repo"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
            }}
            className="flex-1 rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
          />
          <Button type="button" size="sm" onClick={handleAdd} disabled={!url.trim()}>
            Add
          </Button>
        </div>
        {error && <p className="mt-1.5 text-xs text-error">{error}</p>}
      </div>
    </section>
  );
}
