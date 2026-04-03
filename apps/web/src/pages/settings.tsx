import { useState, useCallback, useEffect } from 'react';
import { useMutation, useQuery } from 'urql';
import { cn } from '../lib/utils';
import Button from '../components/common/button';
import Toggle from '../components/common/toggle';
import { GateCard } from '../components/common/feature-gate';
import { useOnboardingStatus } from '../lib/onboarding-context';
import { SecurityModal } from '../components/settings/security-modal';
import { TimePicker } from '../components/onboarding/time-picker';
import { TimezonePicker } from '../components/onboarding/timezone-picker';
import { ChannelCard } from '../components/channels/channel-card';
import { ConnectChannelModal } from '../components/channels/connect-channel-modal';
import {
  useListChannels,
  useDisconnectChannel,
  useNotificationPreferences,
  useSaveNotificationPreferences,
} from '../api/hooks/use-channels';
import {
  AI_CONFIG_QUERY,
  BRIEFING_CONFIG_QUERY,
  ONBOARDING_STATUS_QUERY,
  SAVE_AI_CONFIG_MUTATION,
  SAVE_AI_CREDENTIAL_MUTATION,
  REMOVE_AI_CREDENTIAL_MUTATION,
  SAVE_BRIEFING_CONFIG_MUTATION,
} from '../api/documents';
import type {
  AiConfigQueryResult,
  OnboardingStatusQueryResult,
  SaveAiConfigMutationResult,
  SaveAiConfigVariables,
  SaveAiCredentialMutationResult,
  SaveAiCredentialVariables,
  RemoveAiCredentialMutationResult,
  RemoveAiCredentialVariables,
} from '../api/types';

interface BriefingConfig {
  time: string;
  timezone: string;
  sections: string[];
  enabled: boolean;
}

interface DigestSection {
  key: string;
  label: string;
  description: string;
}

const DIGEST_SECTIONS: DigestSection[] = [
  { key: 'portfolio-performance', label: 'Portfolio performance', description: 'Change since yesterday' },
  { key: 'top-movers', label: 'Top movers', description: 'Biggest gainers and losers' },
  { key: 'earnings-calendar', label: 'Earnings calendar', description: 'Upcoming earnings' },
  { key: 'analyst-ratings', label: 'Analyst rating changes', description: 'Upgrades and downgrades' },
  { key: 'insider-activity', label: 'Insider activity', description: 'Insider buys and sells' },
  { key: 'market-sentiment', label: 'Market sentiment', description: 'Overall mood and VIX' },
  { key: 'macro-events', label: 'Macro events', description: 'Fed, CPI, etc.' },
];

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'America/New_York';
  }
}

export default function Settings() {
  const [{ data: statusData }] = useQuery<OnboardingStatusQueryResult>({
    query: ONBOARDING_STATUS_QUERY,
  });
  const onboardingCompleted = statusData?.onboardingStatus?.completed ?? true;
  const jintelConfigured = statusData?.onboardingStatus?.jintelConfigured ?? false;
  const { openOnboarding } = useOnboardingStatus();

  const [privacy, setPrivacy] = useState({
    piiRedaction: true,
    auditLogging: true,
  });

  const [securityOpen, setSecurityOpen] = useState(false);
  const closeSecurityModal = useCallback(() => setSecurityOpen(false), []);

  const updatePrivacy = (key: keyof typeof privacy) => (value: boolean) => {
    setPrivacy((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="flex-1 overflow-auto p-6 max-w-4xl mx-auto w-full flex flex-col gap-6">
      <div className="relative rounded-xl border border-border bg-bg-card">
        <div className="p-5 space-y-4">
          <h3 className="text-xs font-medium uppercase tracking-wider text-text-secondary">AI Provider</h3>
          <ModelPicker />
        </div>

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

      {/* Daily Insights */}
      <div className="relative rounded-xl border border-border bg-bg-card">
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-medium uppercase tracking-wider text-text-secondary">Daily Insights</h3>
          </div>
          <BriefingEditor />
        </div>
        {!jintelConfigured && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-bg-primary/70 backdrop-blur-[3px]">
            <GateCard
              requires="jintel"
              subtitle="Jintel is free to use. Connect it to unlock live market data and analytics."
            />
          </div>
        )}
      </div>

      {/* Delivery Channels */}
      <div className="relative rounded-xl border border-border bg-bg-card">
        <div className="p-5 space-y-4">
          <h3 className="text-xs font-medium uppercase tracking-wider text-text-secondary">Delivery Channels</h3>
          <p className="text-sm text-text-muted">
            Connect messaging channels for notifications, approvals, and daily briefings.
          </p>
          <ChannelsSection />
        </div>
        {!jintelConfigured && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-bg-primary/70 backdrop-blur-[3px]">
            <GateCard
              requires="jintel"
              subtitle="Jintel is free to use. Connect it to unlock live market data and analytics."
            />
          </div>
        )}
      </div>

      {/* Notification Routing */}
      <div className="relative rounded-xl border border-border bg-bg-card">
        <div className="p-5 space-y-4">
          <h3 className="text-xs font-medium uppercase tracking-wider text-text-secondary">Notification Routing</h3>
          <p className="text-sm text-text-muted">Choose which notifications each channel receives.</p>
          <NotificationPreferencesEditor />
        </div>
        {!jintelConfigured && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-bg-primary/70 backdrop-blur-[3px]">
            <GateCard
              requires="jintel"
              subtitle="Jintel is free to use. Connect it to unlock live market data and analytics."
            />
          </div>
        )}
      </div>

      {/* Data & Privacy */}
      <div className="relative rounded-xl border border-border bg-bg-card">
        <div className="p-5 space-y-4">
          <h3 className="text-xs font-medium uppercase tracking-wider text-text-secondary">Data & Privacy</h3>
          <div className="space-y-4">
            <Toggle
              label="PII redaction"
              description="Strip personal identifiers before external API calls"
              checked={privacy.piiRedaction}
              onChange={updatePrivacy('piiRedaction')}
              disabled={!jintelConfigured}
            />
            <Toggle
              label="Audit logging"
              description="Log all security events to audit trail"
              checked={privacy.auditLogging}
              onChange={updatePrivacy('auditLogging')}
              disabled={!jintelConfigured}
            />
          </div>
          <button
            onClick={() => setSecurityOpen(true)}
            className="flex cursor-pointer items-center gap-1 text-sm text-success transition-colors hover:text-success/80"
          >
            How Yojin protects your data
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
              />
            </svg>
          </button>
        </div>
        {!jintelConfigured && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-bg-primary/70 backdrop-blur-[3px]">
            <GateCard
              requires="jintel"
              subtitle="Jintel is free to use. Connect it to unlock live market data and analytics."
            />
          </div>
        )}
      </div>
      <SecurityModal open={securityOpen} onClose={closeSecurityModal} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI Provider + Model Picker
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

  // API key state
  const [apiKey, setApiKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keySuccess, setKeySuccess] = useState(false);

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
// Briefing schedule editor
// ---------------------------------------------------------------------------

function BriefingEditor() {
  const [result] = useQuery<{ briefingConfig: BriefingConfig | null }>({ query: BRIEFING_CONFIG_QUERY });
  const [, saveBriefing] = useMutation(SAVE_BRIEFING_CONFIG_MUTATION);

  const config = result.data?.briefingConfig;
  const loading = result.fetching;

  const [time, setTime] = useState('08:00');
  const [timezone, setTimezone] = useState(detectTimezone);
  const [sections, setSections] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Sync from server when loaded
  useEffect(() => {
    if (config) {
      setTime(config.time);
      setTimezone(config.timezone);
      setSections(config.sections);
      setDirty(false);
    }
  }, [config]);

  const markDirty = () => {
    setDirty(true);
    setSaved(false);
    setSaveError(null);
  };
  const handleTimeChange = (t: string) => {
    setTime(t);
    markDirty();
  };
  const handleTimezoneChange = (tz: string) => {
    setTimezone(tz);
    markDirty();
  };
  const toggleSection = (key: string) => {
    setSections((prev) => (prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]));
    markDirty();
  };

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const result = await saveBriefing({ input: { time, timezone, sections } });
      if (result.error) {
        setSaveError(result.error.message || 'Failed to save schedule');
        return;
      }
      setSaved(true);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }, [saveBriefing, time, timezone, sections]);

  if (loading) {
    return <p className="text-sm text-text-muted">Loading schedule...</p>;
  }

  if (!config) {
    return (
      <p className="text-sm text-text-muted">
        No briefing configured yet. Complete onboarding to set up your daily insights schedule.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {/* Schedule */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-text-secondary">Run daily at</p>
        <div className="flex items-center gap-4">
          <TimePicker value={time} onChange={handleTimeChange} />
          <TimezonePicker value={timezone} onChange={handleTimezoneChange} />
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-text-secondary">Include in briefing</p>
        <div className="divide-y divide-border rounded-xl border border-border bg-bg-card">
          {DIGEST_SECTIONS.map((section) => (
            <div key={section.key} className="px-4 py-2.5">
              <Toggle
                size="sm"
                checked={sections.includes(section.key)}
                onChange={() => toggleSection(section.key)}
                label={section.label}
                description={section.description}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button variant="primary" size="sm" loading={saving} disabled={!dirty} onClick={handleSave}>
          Save schedule
        </Button>
        {saved && <span className="text-xs text-success">Saved</span>}
        {saveError && <span className="text-xs text-error">{saveError}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notification preferences editor
// ---------------------------------------------------------------------------

const NOTIFICATION_TYPES = [
  { key: 'snap.ready', label: 'Snap briefs', description: 'Periodic attention summaries' },
  { key: 'insight.ready', label: 'Daily insights', description: 'Full portfolio analysis reports' },
  { key: 'action.created', label: 'Action alerts', description: 'Skill-triggered trade recommendations' },
  { key: 'approval.requested', label: 'Approval requests', description: 'Actions requiring your approval' },
];
/** Types enabled by default when user has no explicit preferences (matches backend DEFAULT_ENABLED_TYPES). */
const DEFAULT_ENABLED_TYPES = ['insight.ready', 'action.created', 'approval.requested'];

function NotificationPreferencesEditor() {
  const [channelsResult] = useListChannels();
  const [prefsResult] = useNotificationPreferences();
  const [, savePrefs] = useSaveNotificationPreferences();

  const channels = (channelsResult.data?.listChannels ?? []).filter((ch) => ch.status === 'CONNECTED');
  const prefs = prefsResult.data?.notificationPreferences ?? [];

  const isEnabled = (channelId: string, notificationType: string): boolean => {
    const channelPrefs = prefs.find((p) => p.channelId === channelId);
    if (!channelPrefs) return DEFAULT_ENABLED_TYPES.includes(notificationType);
    return channelPrefs.enabledTypes.includes(notificationType);
  };

  const [saveError, setSaveError] = useState<string | null>(null);

  const handleToggle = async (channelId: string, notificationType: string) => {
    const channelPrefs = prefs.find((p) => p.channelId === channelId);
    const currentTypes = channelPrefs?.enabledTypes ?? DEFAULT_ENABLED_TYPES;

    const newTypes = currentTypes.includes(notificationType)
      ? currentTypes.filter((t) => t !== notificationType)
      : [...currentTypes, notificationType];

    setSaveError(null);
    const res = await savePrefs({ channelId, enabledTypes: newTypes });
    if (res.error) {
      setSaveError(res.error.message || 'Failed to save');
    }
  };

  if (channelsResult.fetching || prefsResult.fetching) {
    return <p className="text-sm text-text-muted">Loading...</p>;
  }

  if (channelsResult.error || prefsResult.error) {
    return <p className="text-sm text-error">Failed to load notification preferences.</p>;
  }

  if (channels.length === 0) {
    return <p className="text-sm text-text-muted">No channels connected.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 pr-4 text-xs font-medium uppercase tracking-wider text-text-muted">
                Notification
              </th>
              {channels.map((ch) => (
                <th
                  key={ch.id}
                  className="text-center py-2 px-3 text-xs font-medium uppercase tracking-wider text-text-muted"
                >
                  {ch.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_TYPES.map((nt) => (
              <tr key={nt.key} className="border-b border-border last:border-0">
                <td className="py-3 pr-4">
                  <p className="text-sm text-text-primary">{nt.label}</p>
                  <p className="text-xs text-text-muted">{nt.description}</p>
                </td>
                {channels.map((ch) => (
                  <td key={ch.id} className="text-center py-3 px-3">
                    <Toggle size="sm" checked={isEnabled(ch.id, nt.key)} onChange={() => handleToggle(ch.id, nt.key)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {saveError && <p className="text-sm text-error">{saveError}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connected channels section
// ---------------------------------------------------------------------------

function ChannelsSection() {
  const [result, reexecute] = useListChannels();
  const [, disconnectChannel] = useDisconnectChannel();
  const [connectModalChannel, setConnectModalChannel] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  const channels = result.data?.listChannels ?? [];

  const handleDisconnect = async (channelId: string) => {
    setDisconnectingId(channelId);
    const res = await disconnectChannel({ id: channelId });
    setDisconnectingId(null);
    if (res.data?.disconnectChannel.success) {
      reexecute({ requestPolicy: 'network-only' });
    }
  };

  const handleConnected = () => {
    setConnectModalChannel(null);
    reexecute({ requestPolicy: 'network-only' });
  };

  if (result.fetching && channels.length === 0) {
    return <p className="text-sm text-text-muted">Loading channels...</p>;
  }

  if (result.error) {
    return <p className="text-sm text-error">Failed to load channels.</p>;
  }

  return (
    <>
      <div className="space-y-3">
        {channels.map((channel) => (
          <ChannelCard
            key={channel.id}
            channel={channel}
            onConnect={setConnectModalChannel}
            onDisconnect={handleDisconnect}
            disconnecting={disconnectingId === channel.id}
          />
        ))}
      </div>

      <ConnectChannelModal
        open={connectModalChannel !== null}
        channelId={connectModalChannel}
        onClose={() => setConnectModalChannel(null)}
        onConnected={handleConnected}
      />
    </>
  );
}
