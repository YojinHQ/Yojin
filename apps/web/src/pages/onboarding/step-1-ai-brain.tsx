import { useState, useEffect, useCallback } from 'react';
import { useOnboarding } from '../../lib/onboarding-context';
import { OnboardingShell } from '../../components/onboarding/onboarding-shell';
import Button from '../../components/common/button';
import Input from '../../components/common/input';
import Badge from '../../components/common/badge';
import { cn } from '../../lib/utils';

type Provider = 'claude' | 'openai' | 'openrouter';

interface ProviderConfig {
  id: Provider;
  name: string;
  subtitle: string;
  logo: string;
}

const PROVIDERS: ProviderConfig[] = [
  { id: 'claude', name: 'Claude', subtitle: 'Anthropic', logo: '/ai-providers/claude.png' },
  { id: 'openai', name: 'OpenAI', subtitle: 'GPT models', logo: '/ai-providers/openai.png' },
  { id: 'openrouter', name: 'OpenRouter', subtitle: 'Multi-model gateway', logo: '/ai-providers/openrouter.png' },
];

type AuthMode = 'keychain' | 'api-key';

export function Step1AiBrain() {
  const { state, updateState, nextStep, prevStep, isReset } = useOnboarding();

  const [provider, setProvider] = useState<Provider>('claude');
  const [authMode, setAuthMode] = useState<AuthMode>('api-key');
  const [apiKey, setApiKey] = useState('');
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState(state.aiProvider?.validated ?? false);
  const [validatedModel, setValidatedModel] = useState(state.aiProvider?.model ?? '');
  const [error, setError] = useState('');
  const [autoDetected, setAutoDetected] = useState(false);

  // Keychain detection — found but NOT auto-accepted (requires user consent)
  const [keychainAvailable, setKeychainAvailable] = useState(false);
  const [keychainModel, setKeychainModel] = useState('');
  const [keychainError, setKeychainError] = useState('');

  // Check for env-detected credential and keychain availability on mount.
  // Env var auto-accepts (explicit user config); keychain requires consent.
  useEffect(() => {
    let cancelled = false;

    async function detectEnv() {
      try {
        const res = await fetch('/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: '{ detectAiCredential { method model } }' }),
        });
        const json = await res.json();
        const cred = json?.data?.detectAiCredential;
        if (!cancelled && cred) {
          setAutoDetected(true);
          setValidated(true);
          setValidatedModel(cred.model || 'Claude');
          updateState({ aiProvider: { method: 'env-detected', model: cred.model, validated: true } });
        }
      } catch {
        // No env credential
      }
    }

    async function detectKeychain() {
      try {
        const res = await fetch('/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: '{ detectKeychainToken { found model error } }' }),
        });
        const json = await res.json();
        const keychain = json?.data?.detectKeychainToken;
        if (!cancelled && keychain?.found) {
          setKeychainAvailable(true);
          setKeychainModel(keychain.model || 'Claude (Keychain)');
          setAuthMode('keychain');
          if (keychain.error) {
            setKeychainError(keychain.error);
          }
        }
      } catch {
        // No keychain token
      }
    }

    // Env auto-accept only runs when not reset and not already validated
    if (!isReset && !validated) {
      detectEnv();
    }

    // Keychain detection always runs (it's non-accepting — just sets availability)
    if (!validated) {
      detectKeychain();
    }

    return () => {
      cancelled = true;
    };
  }, [isReset, validated, updateState]);

  const handleSelectProvider = (p: Provider) => {
    if (p === provider) return;
    setProvider(p);
    setAuthMode(p === 'claude' && keychainAvailable ? 'keychain' : 'api-key');
    setApiKey('');
    setError('');
    if (!autoDetected) {
      setValidated(false);
      setValidatedModel('');
    }
  };

  const handleUseKeychain = useCallback(() => {
    setValidated(true);
    setValidatedModel(keychainModel);
    updateState({ aiProvider: { method: 'keychain', model: keychainModel, validated: true } });
  }, [keychainModel, updateState]);

  const handleRetryKeychain = useCallback(async () => {
    setValidating(true);
    setKeychainError('');
    try {
      const res = await fetch('/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '{ detectKeychainToken { found model error } }' }),
      });
      const json = await res.json();
      const keychain = json?.data?.detectKeychainToken;
      if (keychain?.found && !keychain.error) {
        setKeychainModel(keychain.model || 'Claude (Keychain)');
        setKeychainError('');
      } else if (keychain?.found) {
        setKeychainError(keychain.error);
      } else {
        setKeychainError('No Claude Code token found in Keychain.');
      }
    } catch {
      setKeychainError('Connection failed. Make sure the backend is running.');
    } finally {
      setValidating(false);
    }
  }, []);

  const handleValidateApiKey = useCallback(async () => {
    if (!apiKey.trim()) {
      setError('Please enter an API key');
      return;
    }
    setError('');
    setValidating(true);
    try {
      const res = await fetch('/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `mutation ($input: ValidateCredentialInput!) { validateAiCredential(input: $input) { success model error } }`,
          variables: {
            input: {
              method: 'API_KEY',
              apiKey: apiKey.trim(),
              provider: provider === 'openrouter' ? 'OPENROUTER' : provider === 'openai' ? 'OPENAI' : 'ANTHROPIC',
            },
          },
        }),
      });
      const json = await res.json();
      const result = json?.data?.validateAiCredential;
      if (result?.success) {
        setValidated(true);
        setValidatedModel(result.model || 'Claude');
        updateState({ aiProvider: { method: 'api-key', model: result.model, validated: true } });
      } else {
        setError(result?.error || 'Invalid API key.');
      }
    } catch {
      setError('Connection failed. Make sure the backend is running.');
    } finally {
      setValidating(false);
    }
  }, [apiKey, provider, updateState]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleContinue = () => {
    if (validated) nextStep();
  };

  // Auto-detected banner (env vars, vault, or keychain)
  if (autoDetected && validated) {
    return (
      <OnboardingShell currentStep={1}>
        <div className="w-full max-w-2xl">
          <div
            className="mb-8 text-center opacity-0 [animation:onboarding-fade-up_0.5s_ease-out_forwards]"
            style={{ animationDelay: '0ms' }}
          >
            <h1 className="mb-2 font-headline text-2xl text-text-primary">Connect your AI brain</h1>
            <p className="text-sm text-text-secondary">Yojin runs on Claude. Choose how to connect.</p>
          </div>

          <div
            className="mb-8 rounded-xl border border-success/30 bg-success/[0.04] p-5 text-center opacity-0 [animation:onboarding-fade-up_0.5s_ease-out_forwards]"
            style={{ animationDelay: '100ms' }}
          >
            <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-success/10">
              <svg
                className="h-5 w-5 text-success"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2.5}
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </div>
            <p className="text-sm font-medium text-text-primary">Already configured</p>
            <p className="mt-1 text-xs text-text-muted">{validatedModel}</p>
          </div>

          <div className="flex items-center justify-between">
            <Button variant="ghost" size="md" onClick={prevStep}>
              <svg className="mr-1 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
              </svg>
              Back
            </Button>
            <Button variant="primary" size="md" onClick={handleContinue}>
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

  return (
    <OnboardingShell currentStep={1}>
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div
          className="mb-8 text-center opacity-0 [animation:onboarding-fade-up_0.5s_ease-out_forwards]"
          style={{ animationDelay: '0ms' }}
        >
          <h1 className="mb-2 font-headline text-2xl text-text-primary">Connect your AI brain</h1>
          <p className="text-sm text-text-secondary">Yojin runs on Claude. Choose your provider.</p>
        </div>

        <div
          className="mb-6 opacity-0 [animation:onboarding-fade-up_0.5s_ease-out_forwards]"
          style={{ animationDelay: '100ms' }}
        >
          {/* Provider cards row */}
          <div className="mb-6 grid grid-cols-3 gap-3">
            {PROVIDERS.map((p) => {
              const isSelected = provider === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelectProvider(p.id)}
                  className={cn(
                    'relative cursor-pointer flex items-center gap-3 rounded-xl border p-4 transition-all duration-200',
                    isSelected
                      ? 'border-accent-primary/60 bg-accent-glow'
                      : 'border-border bg-bg-card hover:border-accent-primary/30 hover:bg-bg-hover/60',
                  )}
                >
                  <img src={p.logo} alt={p.name} className="h-10 w-10 rounded-lg" />
                  <div className="text-left">
                    <p className={cn('text-sm font-medium', isSelected ? 'text-text-primary' : 'text-text-secondary')}>
                      {p.name}
                    </p>
                    <p className="text-xs text-text-muted">{p.subtitle}</p>
                  </div>
                  {/* Checkmark */}
                  {isSelected && (
                    <div className="absolute top-2.5 right-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent-primary">
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
                  {/* Unselected radio */}
                  {!isSelected && (
                    <div className="absolute top-3 right-3 h-4 w-4 rounded-full border-2 border-border-light" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Config form — changes based on provider */}
          <div className="rounded-xl border border-border bg-bg-card p-5">
            {/* Validated state */}
            {validated && (
              <div className="flex items-center gap-3">
                <Badge variant="success" size="sm">
                  Verified
                </Badge>
                <span className="text-sm text-text-secondary">{validatedModel}</span>
              </div>
            )}

            {/* Claude: Keychain or API key */}
            {!validated && provider === 'claude' && (
              <div className="space-y-4">
                {/* Auth mode toggle — only show if keychain is available */}
                {keychainAvailable && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode('keychain');
                        setError('');
                      }}
                      className={cn(
                        'cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                        authMode === 'keychain'
                          ? 'bg-bg-tertiary text-text-primary'
                          : 'text-text-muted hover:bg-bg-hover/50 hover:text-text-secondary',
                      )}
                    >
                      Use Claude Code
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode('api-key');
                        setError('');
                      }}
                      className={cn(
                        'cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                        authMode === 'api-key'
                          ? 'bg-bg-tertiary text-text-primary'
                          : 'text-text-muted hover:bg-bg-hover/50 hover:text-text-secondary',
                      )}
                    >
                      API key
                    </button>
                  </div>
                )}

                {/* Keychain consent card */}
                {authMode === 'keychain' && keychainAvailable && (
                  <div className="space-y-3">
                    <div className="rounded-lg bg-bg-tertiary/50 p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <svg
                          className="h-4 w-4 text-text-secondary"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={1.5}
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z"
                          />
                        </svg>
                        <p className="text-xs font-medium text-text-primary">Claude Code token found</p>
                      </div>
                      <p className="text-[11px] leading-relaxed text-text-muted">
                        {keychainError
                          ? 'A Claude Code token was found in your macOS Keychain but it has expired. Run "claude auth login" in your terminal to re-authenticate, then try again.'
                          : 'We detected a Claude Code OAuth token in your macOS Keychain. Yojin can use this token to connect to Claude without needing a separate API key.'}
                      </p>
                    </div>
                    {keychainError ? (
                      <Button
                        variant="secondary"
                        size="md"
                        loading={validating}
                        onClick={handleRetryKeychain}
                        className="w-full"
                      >
                        <svg
                          className="mr-1.5 h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={1.5}
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.992 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182"
                          />
                        </svg>
                        Try again
                      </Button>
                    ) : (
                      <Button variant="primary" size="md" onClick={handleUseKeychain} className="w-full">
                        <svg
                          className="mr-1.5 h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={1.5}
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                        </svg>
                        Use Claude Code token
                      </Button>
                    )}
                  </div>
                )}

                {/* API key form */}
                {authMode === 'api-key' && (
                  <div className="space-y-3">
                    <Input
                      label="Anthropic API key"
                      type="password"
                      placeholder="sk-ant-..."
                      hint="console.anthropic.com"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      error={error || undefined}
                      size="md"
                      onKeyDown={(e) => e.key === 'Enter' && handleValidateApiKey()}
                    />
                    <Button
                      variant="primary"
                      size="md"
                      loading={validating}
                      disabled={!apiKey.trim()}
                      onClick={handleValidateApiKey}
                      className="w-full"
                    >
                      Verify key
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* OpenAI: API key only */}
            {!validated && provider === 'openai' && (
              <div className="space-y-3">
                <Input
                  label="OpenAI API key"
                  type="password"
                  placeholder="sk-..."
                  hint="platform.openai.com/api-keys"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  error={error || undefined}
                  size="md"
                  onKeyDown={(e) => e.key === 'Enter' && handleValidateApiKey()}
                />
                <Button
                  variant="primary"
                  size="md"
                  loading={validating}
                  disabled={!apiKey.trim()}
                  onClick={handleValidateApiKey}
                  className="w-full"
                >
                  Verify key
                </Button>
              </div>
            )}

            {/* OpenRouter: API key only */}
            {!validated && provider === 'openrouter' && (
              <div className="space-y-3">
                <Input
                  label="OpenRouter API key"
                  type="password"
                  placeholder="sk-or-..."
                  hint="openrouter.ai/keys"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  error={error || undefined}
                  size="md"
                  onKeyDown={(e) => e.key === 'Enter' && handleValidateApiKey()}
                />
                <Button
                  variant="primary"
                  size="md"
                  loading={validating}
                  disabled={!apiKey.trim()}
                  onClick={handleValidateApiKey}
                  className="w-full"
                >
                  Verify key
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Navigation */}
        <div
          className="flex items-center justify-between opacity-0 [animation:onboarding-fade-up_0.5s_ease-out_forwards]"
          style={{ animationDelay: '200ms' }}
        >
          <Button variant="ghost" size="md" onClick={prevStep}>
            <svg className="mr-1 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Back
          </Button>
          <Button variant="primary" size="md" disabled={!validated} onClick={handleContinue}>
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
