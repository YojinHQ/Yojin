import { useState } from 'react';

import { useAddDataSource, useListVaultSecrets, useListDataSources } from '../../api/hooks';
import type { DataSourceInput, DataSourceType } from '../../api/types';
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
  secretRef: string;
  baseUrl: string;
  description: string;
}

const CATALOG: CatalogEntry[] = [
  {
    id: 'exa-search',
    name: 'Exa Search',
    type: 'API',
    capabilities: ['web-search', 'news'],
    secretRef: 'EXA_API_KEY',
    baseUrl: 'https://api.exa.ai',
    description: 'Neural web search — find semantically similar content',
  },
  {
    id: 'firecrawl',
    name: 'Firecrawl',
    type: 'API',
    capabilities: ['web-scrape', 'crawl'],
    secretRef: 'FIRECRAWL_API_KEY',
    baseUrl: 'https://api.firecrawl.dev',
    description: 'Scrape and crawl websites into clean markdown',
  },
  {
    id: 'fmp',
    name: 'Financial Modeling Prep',
    type: 'API',
    capabilities: ['market-data', 'fundamentals', 'news'],
    secretRef: 'FMP_API_KEY',
    baseUrl: 'https://financialmodelingprep.com/api',
    description: 'Stock fundamentals, financials, and market data',
  },
  {
    id: 'benzinga',
    name: 'Benzinga',
    type: 'API',
    capabilities: ['news', 'market-data'],
    secretRef: 'BENZINGA_API_KEY',
    baseUrl: 'https://api.benzinga.com',
    description: 'Real-time financial news and market data',
  },
  {
    id: 'polygon',
    name: 'Polygon.io',
    type: 'API',
    capabilities: ['market-data', 'news', 'crypto'],
    secretRef: 'POLYGON_API_KEY',
    baseUrl: 'https://api.polygon.io',
    description: 'Real-time and historical market data',
  },
  {
    id: 'alpha-vantage',
    name: 'Alpha Vantage',
    type: 'API',
    capabilities: ['market-data', 'fundamentals', 'forex'],
    secretRef: 'ALPHA_VANTAGE_API_KEY',
    baseUrl: 'https://www.alphavantage.co',
    description: 'Stock, forex, and crypto market data',
  },
  {
    id: 'newsapi',
    name: 'NewsAPI',
    type: 'API',
    capabilities: ['news'],
    secretRef: 'NEWSAPI_KEY',
    baseUrl: 'https://newsapi.org',
    description: 'Global news aggregation from 150K+ sources',
  },
  {
    id: 'fred',
    name: 'FRED (St. Louis Fed)',
    type: 'API',
    capabilities: ['macro', 'economic-data'],
    secretRef: 'FRED_API_KEY',
    baseUrl: 'https://api.stlouisfed.org',
    description: 'Economic data — GDP, employment, inflation, rates',
  },
  {
    id: 'apify',
    name: 'Apify',
    type: 'API',
    capabilities: ['web-scrape', 'crawl', 'social'],
    secretRef: 'APIFY_API_KEY',
    baseUrl: 'https://api.apify.com',
    description: 'Web scraping actors and dataset collection',
  },
  {
    id: 'bright-data',
    name: 'Bright Data',
    type: 'API',
    capabilities: ['web-scrape', 'social'],
    secretRef: 'BRIGHT_DATA_API_KEY',
    baseUrl: 'https://api.brightdata.com',
    description: 'Web data collection at scale',
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AddDataSourceModal({ open, onClose }: AddDataSourceModalProps) {
  const [step, setStep] = useState<'catalog' | 'details'>('catalog');
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

  const [, addDataSource] = useAddDataSource();
  const [{ data: vaultData }] = useListVaultSecrets();
  const [{ data: dsData }] = useListDataSources();

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
  }

  function handleClose() {
    reset();
    onClose();
  }

  function selectCatalogEntry(entry: CatalogEntry) {
    setSelectedEntry(entry);
    setId(entry.id);
    setName(entry.name);
    setSourceType(entry.type);
    setCapabilities(entry.capabilities.join(', '));
    setBaseUrl(entry.baseUrl);
    setSecretRef(entry.secretRef);
    setStep('details');
  }

  function selectCustom() {
    setSelectedEntry(null);
    setId('');
    setName('');
    setSourceType('API');
    setCapabilities('');
    setBaseUrl('');
    setSecretRef('');
    setCommand('');
    setArgs('');
    setStep('details');
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
    } else if (sourceType === 'CLI') {
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

  const canSubmit = id.trim() && name.trim() && capabilities.trim();

  // Partition catalog: available (have key in vault), rest, already connected
  const available = CATALOG.filter((e) => vaultKeys.has(e.secretRef) && !existingIds.has(e.id));
  const rest = CATALOG.filter((e) => !vaultKeys.has(e.secretRef) && !existingIds.has(e.id));

  return (
    <Modal open={open} onClose={handleClose} title="Add Data Source">
      {step === 'catalog' ? (
        <div className="space-y-4">
          {/* Auto-detected sources */}
          {available.length > 0 && (
            <div>
              <p className="text-xs font-medium text-text-secondary mb-2 flex items-center gap-2">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
                Detected in vault
              </p>
              <div className="space-y-2">
                {available.map((entry) => (
                  <CatalogButton key={entry.id} entry={entry} hasKey onClick={() => selectCatalogEntry(entry)} />
                ))}
              </div>
            </div>
          )}

          {/* Other known sources */}
          {rest.length > 0 && (
            <div>
              <p className="text-xs font-medium text-text-secondary mb-2">Available sources</p>
              <div className="space-y-2">
                {rest.map((entry) => (
                  <CatalogButton
                    key={entry.id}
                    entry={entry}
                    hasKey={false}
                    onClick={() => selectCatalogEntry(entry)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Custom */}
          <button
            onClick={selectCustom}
            className="w-full flex items-center gap-3 rounded-xl border border-dashed border-border p-4 text-left hover:border-accent-primary hover:bg-accent-primary/5 transition-colors"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-bg-tertiary text-text-muted shrink-0">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-text-primary">Custom source</p>
              <p className="text-xs text-text-muted">Connect any API, MCP server, or CLI tool</p>
            </div>
          </button>
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
                  placeholder="e.g. openbb, python"
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

function CatalogButton({ entry, hasKey, onClick }: { entry: CatalogEntry; hasKey: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 rounded-xl border border-border p-3 text-left hover:border-accent-primary hover:bg-accent-primary/5 transition-colors"
    >
      <div
        className={`flex h-9 w-9 items-center justify-center rounded-lg shrink-0 ${
          hasKey ? 'bg-success/10 text-success' : 'bg-accent-primary/10 text-accent-primary'
        }`}
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375"
          />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary">{entry.name}</span>
          {hasKey && (
            <Badge variant="success" size="xs">
              Key ready
            </Badge>
          )}
        </div>
        <p className="text-xs text-text-muted truncate">{entry.description}</p>
      </div>
      <div className="flex flex-wrap gap-1 shrink-0">
        {entry.capabilities.slice(0, 2).map((c) => (
          <Badge key={c} variant="neutral" size="xs">
            {c}
          </Badge>
        ))}
      </div>
    </button>
  );
}
