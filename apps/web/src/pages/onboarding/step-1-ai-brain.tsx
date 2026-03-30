import { useState } from 'react';
import { useMutation, useQuery } from 'urql';
import { useOnboarding } from '../../lib/onboarding-context';
import { OnboardingShell } from '../../components/onboarding/onboarding-shell';
import Button from '../../components/common/button';
import {
  SAVE_AI_CONFIG_MUTATION,
  AI_CONFIG_QUERY,
  DETECT_KEYCHAIN_TOKEN_QUERY,
  DETECT_CODEX_TOKEN_QUERY,
} from '../../api/documents';
import type { AiConfigQueryResult, DetectKeychainTokenResult, DetectCodexTokenResult } from '../../api/types';
import { cn } from '../../lib/utils';

type Provider = 'claude' | 'codex';

interface ProviderConfig {
  id: Provider;
  name: string;
  subtitle: string;
  logo: string;
  /** Backend provider ID used by ProviderRouter */
  backendId: 'claude-code' | 'codex';
  method: 'keychain' | 'codex';
  defaultModel: string;
}

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    subtitle: 'Anthropic',
    logo: '/ai-providers/claude.png',
    backendId: 'claude-code',
    method: 'keychain',
    defaultModel: 'claude-opus-4-6',
  },
  {
    id: 'codex',
    name: 'Codex',
    subtitle: 'OpenAI',
    logo: '/ai-providers/openai.png',
    backendId: 'codex',
    method: 'codex',
    defaultModel: 'gpt-5.4',
  },
];

/** Maps provider ID to backend provider ID for config comparison */
const BACKEND_TO_PROVIDER: Record<string, Provider> = {
  'claude-code': 'claude',
  codex: 'codex',
};

export function Step1AiBrain() {
  const { state, updateState, nextStep, prevStep } = useOnboarding();
  const [, saveAiConfig] = useMutation(SAVE_AI_CONFIG_MUTATION);

  // Detection queries — network-only since these detect machine state
  const [keychainResult] = useQuery<DetectKeychainTokenResult>({
    query: DETECT_KEYCHAIN_TOKEN_QUERY,
    requestPolicy: 'network-only',
  });
  const [codexResult] = useQuery<DetectCodexTokenResult>({
    query: DETECT_CODEX_TOKEN_QUERY,
    requestPolicy: 'network-only',
  });

  // Current saved config — to show "Active" indicator
  const [configResult] = useQuery<AiConfigQueryResult>({
    query: AI_CONFIG_QUERY,
    requestPolicy: 'network-only',
  });

  const claudeDetected = keychainResult.data?.detectKeychainToken.found ?? false;
  const codexDetected = codexResult.data?.detectCodexToken.found ?? false;
  const detecting = keychainResult.fetching || codexResult.fetching;

  const activeProvider: Provider | undefined = configResult.data?.aiConfig.defaultProvider
    ? BACKEND_TO_PROVIDER[configResult.data.aiConfig.defaultProvider]
    : undefined;

  const [selected, setSelected] = useState<Provider>(state.aiProvider?.method === 'codex' ? 'codex' : 'claude');

  const noneDetected = !detecting && !claudeDetected && !codexDetected;

  // Fall back to whichever provider is actually available
  const effectiveSelected: Provider =
    !detecting && !codexDetected && selected === 'codex'
      ? 'claude'
      : !detecting && !claudeDetected && selected === 'claude'
        ? 'codex'
        : selected;

  // Can only continue if the selected provider is actually detected
  const canContinue = !detecting && (effectiveSelected === 'claude' ? claudeDetected : codexDetected);

  const handleContinue = () => {
    const provider = PROVIDERS.find((p) => p.id === effectiveSelected);
    if (!provider) return;
    updateState({
      aiProvider: { method: provider.method, model: provider.defaultModel, validated: true },
    });
    // Persist provider + model to backend so settings page reflects the choice
    saveAiConfig({ input: { defaultProvider: provider.backendId, defaultModel: provider.defaultModel } });
    nextStep();
  };

  const getDetectionStatus = (
    id: Provider,
  ): { detected: boolean; loading: boolean; isActive: boolean; error?: string } => {
    const active = activeProvider === id;
    if (id === 'claude') {
      return {
        detected: claudeDetected,
        loading: keychainResult.fetching,
        isActive: active,
        error: keychainResult.data?.detectKeychainToken.error,
      };
    }
    return {
      detected: codexDetected,
      loading: codexResult.fetching,
      isActive: active,
      error: codexResult.data?.detectCodexToken.error,
    };
  };

  return (
    <OnboardingShell currentStep={1}>
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div
          className="mb-8 text-center opacity-0 [animation:onboarding-fade-up_0.5s_ease-out_forwards]"
          style={{ animationDelay: '0ms' }}
        >
          <h1 className="mb-2 font-headline text-2xl text-text-primary">Connect your AI brain</h1>
          <p className="text-sm text-text-secondary">Choose which AI assistant powers Yojin.</p>
        </div>

        {/* Provider cards */}
        <div
          className="mb-8 grid grid-cols-2 gap-4 opacity-0 [animation:onboarding-fade-up_0.5s_ease-out_forwards]"
          style={{ animationDelay: '100ms' }}
        >
          {PROVIDERS.map((p) => {
            const isSelected = effectiveSelected === p.id;
            const status = getDetectionStatus(p.id);
            const isDisabled = !status.loading && !status.detected;

            return (
              <button
                key={p.id}
                type="button"
                disabled={isDisabled}
                onClick={() => !isDisabled && setSelected(p.id)}
                className={cn(
                  'group relative flex flex-col items-center gap-4 rounded-2xl border-2 px-6 py-8 transition-all duration-300',
                  isDisabled
                    ? 'cursor-not-allowed border-border/50 bg-bg-card/40 opacity-50'
                    : isSelected
                      ? 'cursor-pointer border-accent-primary bg-accent-glow shadow-[0_0_24px_-4px_var(--color-accent-primary)]'
                      : 'cursor-pointer border-border bg-bg-card hover:border-accent-primary/40 hover:bg-bg-hover/60',
                )}
              >
                {/* Logo */}
                <div
                  className={cn(
                    'flex h-16 w-16 items-center justify-center rounded-2xl transition-transform duration-300',
                    isDisabled ? '' : isSelected ? 'scale-110' : 'group-hover:scale-105',
                  )}
                >
                  <img src={p.logo} alt={p.name} className={cn('h-14 w-14 rounded-xl', isDisabled && 'grayscale')} />
                </div>

                {/* Name + subtitle + status (single block, no stacking) */}
                <div className="text-center">
                  <p
                    className={cn(
                      'text-base font-semibold transition-colors',
                      isDisabled ? 'text-text-muted' : isSelected ? 'text-accent-primary' : 'text-text-primary',
                    )}
                  >
                    {p.name}
                  </p>
                  <p className="mt-0.5 text-xs text-text-muted">{p.subtitle}</p>

                  {/* Status line — single, minimal indicator below subtitle */}
                  <p className="mt-2 text-2xs">
                    {status.loading ? (
                      <span className="text-text-muted">Checking...</span>
                    ) : status.error ? (
                      <span className="text-warning">{status.error}</span>
                    ) : status.detected ? (
                      <span className={status.isActive ? 'text-accent-primary' : 'text-success'}>
                        {status.isActive ? 'Connected' : 'Available'}
                      </span>
                    ) : (
                      <span className="text-text-muted">Not installed</span>
                    )}
                  </p>
                </div>

                {/* Selection ring */}
                <div
                  className={cn(
                    'absolute top-3 right-3 flex h-6 w-6 items-center justify-center rounded-full transition-all duration-200',
                    isDisabled
                      ? 'border-2 border-border/40 scale-90'
                      : isSelected
                        ? 'bg-accent-primary scale-100'
                        : 'border-2 border-border-light scale-90',
                  )}
                >
                  {isSelected && !isDisabled && (
                    <svg
                      className="h-3.5 w-3.5 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={3}
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* No providers detected — setup instructions */}
        {noneDetected && (
          <div
            className="mb-8 rounded-xl border border-warning/30 bg-warning/5 px-5 py-4 opacity-0 [animation:onboarding-fade-up_0.5s_ease-out_forwards]"
            style={{ animationDelay: '200ms' }}
          >
            <p className="mb-3 text-xs font-medium text-warning">No AI provider detected</p>
            <p className="mb-3 text-2xs leading-relaxed text-text-secondary">
              Yojin needs at least one AI provider to function. Set up one of the following:
            </p>
            <div className="space-y-2">
              <div className="rounded-lg bg-bg-tertiary/50 px-3 py-2">
                <p className="text-2xs font-medium text-text-primary">Claude Code</p>
                <p className="mt-0.5 text-3xs text-text-muted">
                  Install Claude Code, then run{' '}
                  <code className="rounded bg-bg-primary/60 px-1 py-px text-text-secondary">claude auth login</code>
                </p>
              </div>
              <div className="rounded-lg bg-bg-tertiary/50 px-3 py-2">
                <p className="text-2xs font-medium text-text-primary">Codex</p>
                <p className="mt-0.5 text-3xs text-text-muted">
                  Install Codex, then run{' '}
                  <code className="rounded bg-bg-primary/60 px-1 py-px text-text-secondary">codex login</code> or set{' '}
                  <code className="rounded bg-bg-primary/60 px-1 py-px text-text-secondary">OPENAI_API_KEY</code>
                </p>
              </div>
            </div>
            <p className="mt-3 text-3xs text-text-muted">Refresh this page after setting up credentials.</p>
          </div>
        )}

        {/* Detection explainer — shown when at least one provider is detected */}
        {!noneDetected && (
          <div
            className="mb-8 rounded-xl border border-border/60 bg-bg-secondary/50 px-4 py-3 opacity-0 [animation:onboarding-fade-up_0.5s_ease-out_forwards]"
            style={{ animationDelay: '200ms' }}
          >
            <p className="text-2xs leading-relaxed text-text-muted">
              Yojin checks for existing credentials on your machine. <span className="text-text-secondary">Claude</span>{' '}
              is detected via macOS Keychain (from{' '}
              <code className="rounded bg-bg-tertiary px-1 py-px text-3xs text-text-secondary">claude auth login</code>
              ). <span className="text-text-secondary">Codex</span> is detected via{' '}
              <code className="rounded bg-bg-tertiary px-1 py-px text-3xs text-text-secondary">~/.codex/auth.json</code>{' '}
              or environment variables. No credentials are sent externally.
            </p>
          </div>
        )}

        {/* Navigation */}
        <div
          className="flex items-center justify-between opacity-0 [animation:onboarding-fade-up_0.5s_ease-out_forwards]"
          style={{ animationDelay: '300ms' }}
        >
          <Button variant="ghost" size="md" onClick={prevStep}>
            <svg className="mr-1 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Back
          </Button>
          <Button variant="primary" size="md" onClick={handleContinue} disabled={!canContinue}>
            Continue
            <svg className="ml-1 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </Button>
        </div>
      </div>
    </OnboardingShell>
  );
}
