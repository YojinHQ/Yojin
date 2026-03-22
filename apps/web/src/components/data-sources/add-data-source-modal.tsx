import { useState } from 'react';

import {
  useAddDataSource,
  useAddVaultSecret,
  useCheckCliCommands,
  useListVaultSecrets,
  useListDataSources,
} from '../../api/hooks';
import type { DataSourceInput, DataSourceType } from '../../api/types';
import { useChatPanel } from '../../lib/chat-panel-context';
import Badge from '../common/badge';
import Button from '../common/button';
import Modal from '../common/modal';

interface AddDataSourceModalProps {
  open: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Known data source catalog — credential key → pre-filled config
// ---------------------------------------------------------------------------

interface CatalogEntry {
  id: string;
  name: string;
  type: DataSourceType;
  capabilities: string[];
  description: string;
  // API-specific
  secretRef?: string;
  baseUrl?: string;
  // CLI/MCP-specific
  command?: string;
  args?: string[];
}

const CATALOG: CatalogEntry[] = [
  // --- CLI tools ---
  {
    id: 'nimble-cli',
    name: 'Nimble',
    type: 'CLI',
    capabilities: ['web-scrape', 'social', 'search'],
    command: 'nimble',
    secretRef: 'NIMBLE_API_KEY',
    description: 'Web scraping and data collection',
  },
  {
    id: 'curl-rss',
    name: 'RSS/Atom Feeds',
    type: 'CLI',
    capabilities: ['news'],
    command: 'curl',
    args: ['-s'],
    description: 'Fetch RSS/Atom feeds via curl — no API key needed',
  },
  // --- API sources ---
  {
    id: 'exa-search',
    name: 'Exa Search',
    type: 'API',
    capabilities: ['web-search', 'news'],
    secretRef: 'EXA_API_KEY',
    baseUrl: 'https://api.exa.ai',
    description: 'Neural web search — find semantically similar content',
  },
];

function getMissingReason(entry: CatalogEntry, availableCommands: Set<string>, vaultKeys: Set<string>): string {
  const parts: string[] = [];
  if (entry.type === 'CLI' && entry.command && !availableCommands.has(entry.command)) {
    parts.push(`${entry.command} not installed`);
  }
  if (entry.secretRef && !vaultKeys.has(entry.secretRef)) {
    parts.push('API key needed');
  }
  return parts.join(' · ') || 'Setup required';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AddDataSourceModal({ open, onClose }: AddDataSourceModalProps) {
  const [step, setStep] = useState<'catalog' | 'details' | 'api-key'>('catalog');
  const [selectedEntry, setSelectedEntry] = useState<CatalogEntry | null>(null);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [sourceType, setSourceType] = useState<DataSourceType>('API');
  const [capabilities, setCapabilities] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [secretRef, setSecretRef] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [apiKeyValue, setApiKeyValue] = useState('');
  const [savingKey, setSavingKey] = useState(false);

  const { openChatWith } = useChatPanel();
  const [, addDataSource] = useAddDataSource();
  const [, addVaultSecret] = useAddVaultSecret();
  const [{ data: vaultData }, reexecuteVaultQuery] = useListVaultSecrets();
  const [{ data: dsData }] = useListDataSources();

  // Check which CLI commands are actually installed on the system
  const cliCommands = CATALOG.filter((e): e is typeof e & { command: string } => e.type === 'CLI' && !!e.command).map(
    (e) => e.command,
  );
  const [{ data: cliData }] = useCheckCliCommands(cliCommands);
  const availableCommands = new Set((cliData?.checkCliCommands ?? []).filter((c) => c.available).map((c) => c.command));

  const vaultKeys = new Set((vaultData?.listVaultSecrets ?? []).map((s) => s.key));
  const existingIds = new Set((dsData?.listDataSources ?? []).map((ds) => ds.id));

  function reset() {
    setStep('catalog');
    setSelectedEntry(null);
    setSourceType('API');
    setId('');
    setName('');
    setCapabilities('');
    setBaseUrl('');
    setSecretRef('');
    setCommand('');
    setArgs('');
    setError(null);
    setApiKeyValue('');
    setSavingKey(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleSetUp(entry: CatalogEntry) {
    if (entry.secretRef) {
      // Needs an API key — show inline input (never goes through the LLM)
      setSelectedEntry(entry);
      setApiKeyValue('');
      setError(null);
      setStep('api-key');
    } else {
      // No API key needed — ask the LLM for installation help
      const prompt = `Install and set up "${entry.name}" (${entry.command}) as a data source. It provides: ${entry.capabilities.join(', ')}.`;
      handleClose();
      openChatWith(prompt);
    }
  }

  async function handleSaveApiKey() {
    if (!selectedEntry?.secretRef || !apiKeyValue.trim()) return;

    setSavingKey(true);
    setError(null);

    // 1. Store the API key in the vault
    const vaultResult = await addVaultSecret({ input: { key: selectedEntry.secretRef, value: apiKeyValue.trim() } });
    if (vaultResult.error || !vaultResult.data?.addVaultSecret.success) {
      setError(vaultResult.data?.addVaultSecret.error ?? vaultResult.error?.message ?? 'Failed to store API key');
      setSavingKey(false);
      return;
    }

    // 2. Add the data source
    const input: DataSourceInput = {
      id: selectedEntry.id,
      name: selectedEntry.name,
      type: selectedEntry.type,
      capabilities: selectedEntry.capabilities,
      baseUrl: selectedEntry.baseUrl,
      secretRef: selectedEntry.secretRef,
    };
    const dsResult = await addDataSource({ input });
    if (dsResult.error || !dsResult.data?.addDataSource.success) {
      setError(dsResult.data?.addDataSource.error ?? dsResult.error?.message ?? 'Failed to add data source');
      setSavingKey(false);
      return;
    }

    // 3. Refresh vault keys list and close
    reexecuteVaultQuery({ requestPolicy: 'network-only' });
    setSavingKey(false);
    handleClose();
  }

  function selectCatalogEntry(entry: CatalogEntry) {
    setSelectedEntry(entry);
    setId(entry.id);
    setName(entry.name);
    setSourceType(entry.type);
    setCapabilities(entry.capabilities.join(', '));
    setBaseUrl(entry.baseUrl ?? '');
    setSecretRef(entry.secretRef ?? '');
    setCommand(entry.command ?? '');
    setArgs(entry.args?.join(' ') ?? '');
    setStep('details');
  }

  function selectCustom() {
    handleClose();
    openChatWith('I want to connect a new data source. What do you need?');
  }

  async function handleSubmit() {
    setError(null);

    const input: DataSourceInput = {
      id: id.trim(),
      name: name.trim(),
      type: sourceType,
      capabilities: capabilities
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
    };

    if (sourceType === 'API') {
      if (baseUrl.trim()) input.baseUrl = baseUrl.trim();
      if (secretRef.trim()) input.secretRef = secretRef.trim();
    } else if (sourceType === 'MCP' || sourceType === 'CLI') {
      if (command.trim()) input.command = command.trim();
      if (args.trim())
        input.args = args
          .split(' ')
          .map((a) => a.trim())
          .filter(Boolean);
    }

    const result = await addDataSource({ input });
    if (result.error || !result.data?.addDataSource.success) {
      setError(result.data?.addDataSource.error ?? result.error?.message ?? 'Failed to add data source');
      return;
    }

    handleClose();
  }

  const canSubmit =
    id.trim() &&
    name.trim() &&
    capabilities
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean).length > 0;

  // Partition catalog: ready (command installed + API key if needed), rest, already connected
  const isReady = (e: CatalogEntry): boolean => {
    const cliOk = e.type !== 'CLI' || (e.command != null && availableCommands.has(e.command));
    const keyOk = !e.secretRef || vaultKeys.has(e.secretRef);
    return cliOk && keyOk;
  };
  const notConnected = CATALOG.filter((e) => !existingIds.has(e.id));
  const available = notConnected.filter(isReady);
  const rest = notConnected.filter((e) => !isReady(e));

  return (
    <Modal open={open} onClose={handleClose} title="Add Data Source">
      {step === 'catalog' ? (
        <div className="space-y-4">
          {/* Auto-detected sources */}
          {available.length > 0 && (
            <div>
              <p className="text-xs font-medium text-text-secondary mb-2 flex items-center gap-2">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
                Ready to connect
              </p>
              <div className="space-y-2">
                {available.map((entry) => (
                  <CatalogButton key={entry.id} entry={entry} hasKey onClick={() => selectCatalogEntry(entry)} />
                ))}
              </div>
            </div>
          )}

          {/* Other known sources — need setup */}
          {rest.length > 0 && (
            <div>
              <p className="text-xs font-medium text-text-secondary mb-2">Needs setup</p>
              <div className="space-y-2">
                {rest.map((entry) => (
                  <CatalogButton
                    key={entry.id}
                    entry={entry}
                    hasKey={false}
                    reason={getMissingReason(entry, availableCommands, vaultKeys)}
                    onSetUp={() => handleSetUp(entry)}
                    onClick={() => selectCatalogEntry(entry)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Custom — agentic setup via LLM */}
          <button
            onClick={selectCustom}
            className="w-full flex items-center gap-3 rounded-xl border border-dashed border-border p-4 text-left hover:border-accent-primary hover:bg-accent-primary/5 transition-colors"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-primary/10 text-accent-primary shrink-0">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z"
                />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-text-primary">Add with AI</p>
              <p className="text-xs text-text-muted">
                Describe what you need — the AI will find, install, and configure it
              </p>
            </div>
          </button>
        </div>
      ) : step === 'api-key' ? (
        <div className="space-y-4">
          <Button variant="ghost" size="sm" onClick={() => setStep('catalog')}>
            &larr; Back
          </Button>

          <div className="rounded-xl border border-border bg-bg-card p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-primary/10 text-accent-primary shrink-0">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z"
                  />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-text-primary">{selectedEntry?.name}</p>
                <p className="text-xs text-text-muted">{selectedEntry?.description}</p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">{selectedEntry?.secretRef}</label>
              <input
                type="password"
                value={apiKeyValue}
                onChange={(e) => setApiKeyValue(e.target.value)}
                placeholder="Paste your API key here"
                className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
                autoFocus
              />
              <p className="text-2xs text-text-muted mt-1.5">
                Stored securely in the encrypted vault. Never sent to the AI.
              </p>
            </div>
          </div>

          {error && <p className="text-sm text-error bg-error/10 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex justify-end gap-3">
            <Button variant="secondary" size="sm" onClick={() => setStep('catalog')}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSaveApiKey}
              disabled={!apiKeyValue.trim() || savingKey}
              loading={savingKey}
            >
              {savingKey ? 'Connecting...' : 'Connect'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Button variant="ghost" size="sm" onClick={() => setStep('catalog')}>
            &larr; Back
          </Button>

          {/* Type selector — only for custom sources */}
          {!selectedEntry && (
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Type</label>
              <div className="flex gap-2">
                {(['API', 'MCP', 'CLI'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setSourceType(t)}
                    className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      sourceType === t
                        ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                        : 'border-border text-text-muted hover:border-text-muted'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">ID</label>
            <input
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="e.g. exa-search, firecrawl"
              className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Exa Search, Firecrawl"
              className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Capabilities</label>
            <input
              type="text"
              value={capabilities}
              onChange={(e) => setCapabilities(e.target.value)}
              placeholder="e.g. web-search, news, market-data"
              className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
            />
            <p className="text-2xs text-text-muted mt-1">Comma-separated list of capabilities this source provides</p>
          </div>

          {sourceType === 'API' && (
            <>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Base URL</label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.example.com"
                  className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Vault Secret Key</label>
                <input
                  type="text"
                  value={secretRef}
                  onChange={(e) => setSecretRef(e.target.value)}
                  placeholder="e.g. EXA_API_KEY"
                  className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
                />
                {secretRef && vaultKeys.has(secretRef) ? (
                  <p className="text-2xs text-success mt-1">Key found in vault</p>
                ) : secretRef ? (
                  <p className="text-2xs text-warning mt-1">Key not in vault — add it in the Credential Vault below</p>
                ) : (
                  <p className="text-2xs text-text-muted mt-1">
                    Reference to an API key stored in the credential vault
                  </p>
                )}
              </div>
            </>
          )}

          {sourceType === 'MCP' && (
            <>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Server Command</label>
                <input
                  type="text"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="e.g. npx @modelcontextprotocol/server-filesystem"
                  className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Arguments</label>
                <input
                  type="text"
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder="e.g. /path/to/dir"
                  className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
                />
              </div>
            </>
          )}

          {sourceType === 'CLI' && (
            <>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Command</label>
                <input
                  type="text"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="e.g. curl, python3"
                  className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Arguments</label>
                <input
                  type="text"
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder="e.g. --format json"
                  className="w-full rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
                />
              </div>
            </>
          )}

          {error && <p className="text-sm text-error bg-error/10 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" size="sm" onClick={handleClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSubmit} disabled={!canSubmit}>
              Add Source
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Catalog button
// ---------------------------------------------------------------------------

function CatalogButton({
  entry,
  hasKey,
  reason,
  onSetUp,
  onClick,
}: {
  entry: CatalogEntry;
  hasKey: boolean;
  reason?: string;
  onSetUp?: () => void;
  onClick: () => void;
}) {
  const isCli = entry.type === 'CLI';

  return (
    <div className="flex items-center gap-2 rounded-xl border border-border p-3 hover:border-accent-primary/50 transition-colors">
      <button onClick={onClick} className="flex items-center gap-3 flex-1 min-w-0 text-left">
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-lg shrink-0 ${
            hasKey ? 'bg-success/10 text-success' : 'bg-bg-tertiary text-text-muted'
          }`}
        >
          {isCli ? (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m6.75 7.5 3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0 0 21 18V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v12a2.25 2.25 0 0 0 2.25 2.25Z"
              />
            </svg>
          ) : (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375"
              />
            </svg>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary">{entry.name}</span>
            {hasKey && isCli && (
              <Badge variant="success" size="xs">
                Installed
              </Badge>
            )}
            {hasKey && !isCli && (
              <Badge variant="success" size="xs">
                Key ready
              </Badge>
            )}
          </div>
          <p className="text-xs text-text-muted truncate">
            {reason ? <span className="text-warning">{reason}</span> : entry.description}
          </p>
        </div>
        <div className="flex flex-wrap gap-1 shrink-0">
          {entry.capabilities.slice(0, 2).map((c) => (
            <Badge key={c} variant="neutral" size="xs">
              {c}
            </Badge>
          ))}
        </div>
      </button>
      {onSetUp && (
        <Button
          variant="secondary"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onSetUp();
          }}
        >
          Set up
        </Button>
      )}
    </div>
  );
}
