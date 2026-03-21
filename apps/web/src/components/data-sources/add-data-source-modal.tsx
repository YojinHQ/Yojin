import { useState } from 'react';

import { useAddDataSource } from '../../api/hooks';
import type { DataSourceInput, DataSourceType } from '../../api/types';
import Button from '../common/button';
import Modal from '../common/modal';

interface AddDataSourceModalProps {
  open: boolean;
  onClose: () => void;
}

const DATA_SOURCE_TYPES: { value: DataSourceType; label: string; description: string }[] = [
  { value: 'API', label: 'REST API', description: 'Connect to a REST/GraphQL API endpoint' },
  { value: 'MCP', label: 'MCP Server', description: 'Model Context Protocol server' },
  { value: 'CLI', label: 'CLI Tool', description: 'Local command-line tool' },
];

export function AddDataSourceModal({ open, onClose }: AddDataSourceModalProps) {
  const [step, setStep] = useState<'type' | 'details'>('type');
  const [sourceType, setSourceType] = useState<DataSourceType>('API');
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [capabilities, setCapabilities] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [secretRef, setSecretRef] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [, addDataSource] = useAddDataSource();

  function reset() {
    setStep('type');
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

  return (
    <Modal open={open} onClose={handleClose} title="Add Data Source">
      {step === 'type' ? (
        <div className="space-y-3">
          <p className="text-sm text-text-secondary mb-4">Select the type of data source to connect.</p>
          {DATA_SOURCE_TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => {
                setSourceType(t.value);
                setStep('details');
              }}
              className="w-full flex items-center gap-3 rounded-xl border border-border p-4 text-left hover:border-accent-primary hover:bg-accent-primary/5 transition-colors"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-primary/10 text-accent-primary shrink-0">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375"
                  />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-text-primary">{t.label}</p>
                <p className="text-xs text-text-muted">{t.description}</p>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <Button variant="ghost" size="sm" onClick={() => setStep('type')}>
            &larr; Back
          </Button>

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
                <p className="text-2xs text-text-muted mt-1">Reference to an API key stored in the credential vault</p>
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
