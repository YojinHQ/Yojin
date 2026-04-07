import { useState, useCallback, useEffect } from 'react';
import { useMutation, useQuery } from 'urql';
import { cn } from '../../lib/utils';
import Card from '../common/card';
import Button from '../common/button';
import { GateCard } from '../common/feature-gate';
import { useOnboardingStatus } from '../../lib/onboarding-context';
import {
  AI_CONFIG_QUERY,
  ONBOARDING_STATUS_QUERY,
  SAVE_AI_CONFIG_MUTATION,
  SAVE_AI_CREDENTIAL_MUTATION,
  REMOVE_AI_CREDENTIAL_MUTATION,
  DETECT_KEYCHAIN_TOKEN_QUERY,
} from '../../api/documents';
import type {
  AiConfigQueryResult,
  OnboardingStatusQueryResult,
  SaveAiConfigMutationResult,
  SaveAiConfigVariables,
  SaveAiCredentialMutationResult,
  SaveAiCredentialVariables,
  RemoveAiCredentialMutationResult,
  RemoveAiCredentialVariables,
  DetectKeychainTokenResult,
} from '../../api/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type AiProviderId = 'claude-code' | 'codex';

interface ProviderOption {
  id: AiProviderId;
  name: string;
  logo: string;
}

const PROVIDERS: ProviderOption[] = [
  { id: 'claude-code', name: 'Claude Code', logo: '/ai-providers/claude.png' },
  { id: 'codex', name: 'Codex', logo: '/ai-providers/openai.png' },
];

const PROVIDER_MODELS: Record<AiProviderId, { id: string; label: string; description: string }[]> = {
  'claude-code': [
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', description: 'Most capable — best for deep analysis' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', description: 'Balanced speed and capability' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', description: 'Fastest — good for high-volume tasks' },
  ],
  codex: [
    { id: 'gpt-5.4', label: 'GPT-5.4', description: 'Latest frontier agentic coding model' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', description: 'Smaller frontier agentic model' },
    { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', description: 'Frontier Codex-optimized model' },
    { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex', description: 'Frontier agentic coding model' },
    { id: 'gpt-5.2', label: 'GPT-5.2', description: 'Professional work and long-running agents' },
    { id: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max', description: 'Deep and fast reasoning' },
    { id: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini', description: 'Cheaper, faster, less capable' },
  ],
};

function resolveProvider(provider: string): AiProviderId {
  if (provider === 'codex') return 'codex';
  return 'claude-code';
}

const PROVIDER_KEY_INFO: Record<
  AiProviderId,
  { placeholder: string; prefix: string; configField: 'hasAnthropicKey' | 'hasOpenaiKey' }
> = {
  'claude-code': { placeholder: 'sk-ant-...', prefix: 'sk-ant-', configField: 'hasAnthropicKey' },
  codex: { placeholder: 'sk-...', prefix: 'sk-', configField: 'hasOpenaiKey' },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AiProviderCard() {
  const [{ data: statusData }] = useQuery<OnboardingStatusQueryResult>({
    query: ONBOARDING_STATUS_QUERY,
  });
  const onboardingCompleted = statusData?.onboardingStatus?.completed ?? true;
  const { openOnboarding } = useOnboardingStatus();

  return (
    <div className="relative">
      <Card className="overflow-hidden p-0">
        {/* Header */}
        <div className="flex items-center gap-4 px-5 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-primary/10">
            <CpuIcon />
          </div>
          <div>
            <h2 className="font-headline text-lg text-text-primary">AI Provider</h2>
            <p className="text-sm text-text-muted">Select your AI provider, model, and manage API keys.</p>
          </div>
        </div>

        {/* Content */}
        <div className="border-t border-border px-5 py-4">
          <ModelPicker />
        </div>
      </Card>

      {!onboardingCompleted && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-bg-primary/70 backdrop-blur-[3px]">
          <GateCard
            requires="ai"
            title="AI provider not configured"
            subtitle="Complete onboarding to select your AI provider and model."
            action={
              <Button size="sm" variant="secondary" onClick={openOnboarding}>
                Go to Onboarding
              </Button>
            }
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ModelPicker (internal)
// ---------------------------------------------------------------------------

function ModelPicker() {
  const [result, reexecuteConfig] = useQuery<AiConfigQueryResult>({ query: AI_CONFIG_QUERY });
  const [, saveAiConfig] = useMutation<SaveAiConfigMutationResult, SaveAiConfigVariables>(SAVE_AI_CONFIG_MUTATION);
  const [, saveCredential] = useMutation<SaveAiCredentialMutationResult, SaveAiCredentialVariables>(
    SAVE_AI_CREDENTIAL_MUTATION,
  );
  const [, removeCredential] = useMutation<RemoveAiCredentialMutationResult, RemoveAiCredentialVariables>(
    REMOVE_AI_CREDENTIAL_MUTATION,
  );

  const [provider, setProvider] = useState<AiProviderId>('claude-code');
  const [selected, setSelected] = useState('claude-opus-4-6');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const [apiKey, setApiKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keySuccess, setKeySuccess] = useState(false);

  const [keychainResult, reexecuteKeychain] = useQuery<DetectKeychainTokenResult>({
    query: DETECT_KEYCHAIN_TOKEN_QUERY,
    requestPolicy: 'network-only',
    pause: provider !== 'claude-code',
  });

  useEffect(() => {
    if (result.data?.aiConfig) {
      const resolved = resolveProvider(result.data.aiConfig.defaultProvider);
      setProvider(resolved);
      const models = PROVIDER_MODELS[resolved];
      const savedModel = result.data.aiConfig.defaultModel;
      const validModel = models.some((m) => m.id === savedModel) ? savedModel : models[0].id;
      setSelected(validModel);
      setDirty(false);
    }
  }, [result.data]);

  const hasKey = result.data?.aiConfig?.[PROVIDER_KEY_INFO[provider].configField] ?? false;

  const handleSelectProvider = (p: AiProviderId) => {
    if (p === provider) return;
    setProvider(p);
    setSelected(PROVIDER_MODELS[p][0].id);
    setDirty(true);
    setSaveError(null);
    setApiKey('');
    setKeyError(null);
    setKeySuccess(false);
  };

  const handleSelectModel = (modelId: string) => {
    setSelected(modelId);
    setDirty(true);
    setSaveError(null);
  };

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await saveAiConfig({ input: { defaultModel: selected, defaultProvider: provider } });
      if (res.error) {
        setSaveError(res.error.message || 'Failed to save');
        return;
      }
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }, [saveAiConfig, selected, provider]);

  const handleSaveKey = useCallback(async () => {
    setSavingKey(true);
    setKeyError(null);
    setKeySuccess(false);
    try {
      const trimmedKey = apiKey.trim();
      if (!trimmedKey) {
        setKeyError('API key cannot be empty');
        return;
      }
      const res = await saveCredential({ provider, apiKey: trimmedKey });
      if (res.error) {
        setKeyError(res.error.message || 'Failed to save');
        return;
      }
      if (!res.data?.saveAiCredential.success) {
        setKeyError(res.data?.saveAiCredential.error || 'Failed to save');
        return;
      }
      setApiKey('');
      setKeySuccess(true);
      reexecuteConfig({ requestPolicy: 'network-only' });
    } finally {
      setSavingKey(false);
    }
  }, [saveCredential, provider, apiKey, reexecuteConfig]);

  const handleRemoveKey = useCallback(async () => {
    setSavingKey(true);
    setKeyError(null);
    try {
      const res = await removeCredential({ provider });
      if (res.error) {
        setKeyError(res.error.message || 'Failed to remove');
        return;
      }
      if (!res.data?.removeAiCredential.success) {
        setKeyError(res.data?.removeAiCredential.error || 'Failed to remove');
        return;
      }
      reexecuteConfig({ requestPolicy: 'network-only' });
    } finally {
      setSavingKey(false);
    }
  }, [removeCredential, provider, reexecuteConfig]);

  if (result.fetching) {
    return <p className="text-sm text-text-muted">Loading...</p>;
  }

  const models = PROVIDER_MODELS[provider];
  const keyInfo = PROVIDER_KEY_INFO[provider];
  const keychain = keychainResult.data?.detectKeychainToken;
  const keychainConnected = keychain?.found && !keychain.error;

  return (
    <div className="space-y-5">
      {/* Provider selector */}
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-text-muted mb-2">Provider</p>
        <div className="grid grid-cols-2 gap-3">
          {PROVIDERS.map((p) => {
            const active = provider === p.id;
            const connected = result.data?.aiConfig?.[PROVIDER_KEY_INFO[p.id].configField] ?? false;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelectProvider(p.id)}
                className={cn(
                  'relative flex items-center gap-3 rounded-xl border p-3.5 transition-all duration-200 cursor-pointer',
                  active
                    ? 'border-accent-primary/60 bg-accent-glow'
                    : 'border-border bg-bg-card hover:border-accent-primary/30 hover:bg-bg-hover/60',
                )}
              >
                <img src={p.logo} alt={p.name} className="h-8 w-8 rounded-lg" />
                <div className="flex flex-col items-start">
                  <span className={cn('text-sm font-medium', active ? 'text-text-primary' : 'text-text-secondary')}>
                    {p.name}
                  </span>
                  {connected && <span className="text-[10px] font-medium text-success">Connected</span>}
                </div>
                {active && (
                  <div className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-accent-primary">
                    <svg
                      className="h-3 w-3 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={3}
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* API Key */}
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-text-muted mb-2">API Key</p>
        {hasKey ? (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-bg-card px-4 py-3">
            <div className="flex-1">
              <p className="text-sm text-text-primary">API key configured</p>
              <p className="text-xs text-text-muted">Stored securely in the encrypted vault</p>
            </div>
            <Button variant="ghost" size="sm" loading={savingKey} onClick={handleRemoveKey}>
              Remove
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setKeyError(null);
                  setKeySuccess(false);
                }}
                placeholder={keyInfo.placeholder}
                className="flex-1 rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary/50 focus:outline-none"
              />
              <Button variant="primary" size="sm" loading={savingKey} disabled={!apiKey.trim()} onClick={handleSaveKey}>
                Save key
              </Button>
            </div>
            {keyError && <p className="text-xs text-error">{keyError}</p>}
            {keySuccess && <p className="text-xs text-success">API key saved</p>}
          </div>
        )}
      </div>

      {/* Keychain authentication (Claude Code only) */}
      {provider === 'claude-code' && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted mb-2">Keychain Authentication</p>
          <div className="rounded-xl border border-border bg-bg-card px-4 py-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-primary">macOS Keychain</p>
                <p className="text-xs text-text-muted">
                  {keychainResult.fetching
                    ? 'Checking...'
                    : keychainConnected
                      ? `Connected · ${keychain?.model ?? 'Claude'}`
                      : keychain?.error
                        ? 'Token expired or invalid'
                        : 'Not connected'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {keychainConnected && <span className="text-xs font-medium text-success">Active</span>}
                <Button
                  variant="ghost"
                  size="sm"
                  loading={keychainResult.fetching}
                  onClick={() => reexecuteKeychain({ requestPolicy: 'network-only' })}
                >
                  Refresh
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Model selector */}
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-text-muted mb-2">Model</p>
        <div className="divide-y divide-border rounded-xl border border-border bg-bg-card">
          {models.map((model) => {
            const active = selected === model.id;
            return (
              <button
                key={model.id}
                type="button"
                onClick={() => handleSelectModel(model.id)}
                className={cn(
                  'flex w-full items-center justify-between px-4 py-3 transition-colors cursor-pointer text-left',
                  active ? 'bg-accent-glow' : 'hover:bg-bg-hover',
                )}
              >
                <div>
                  <p className={cn('text-sm font-medium', active ? 'text-accent-primary' : 'text-text-primary')}>
                    {model.label}
                  </p>
                  <p className="text-xs text-text-muted">{model.description}</p>
                </div>
                <div
                  className={cn(
                    'h-4 w-4 rounded-full border-2 flex-shrink-0 transition-colors',
                    active ? 'border-accent-primary bg-accent-primary' : 'border-border bg-transparent',
                  )}
                />
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button variant="primary" size="sm" loading={saving} disabled={!dirty} onClick={handleSave}>
          Save
        </Button>
        {saveError && <span className="text-xs text-error">{saveError}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icon
// ---------------------------------------------------------------------------

function CpuIcon() {
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
        d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Zm.75-12h9v9h-9v-9Z"
      />
    </svg>
  );
}
