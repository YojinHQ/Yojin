import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from 'urql';
import { useOnboarding } from '../../lib/onboarding-context';
import { OnboardingShell } from '../../components/onboarding/onboarding-shell';
import Button from '../../components/common/button';
import Input from '../../components/common/input';
import Badge from '../../components/common/badge';
import { cn } from '../../lib/utils';
import {
  DETECT_AI_CREDENTIAL_QUERY,
  DETECT_KEYCHAIN_TOKEN_QUERY,
  VALIDATE_AI_CREDENTIAL_MUTATION,
} from '../../api/documents';

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

// Auth mode removed — only API key + auto-detection (env/keychain) supported

export function Step1AiBrain() {
  const { state, updateState, nextStep, prevStep, isReset } = useOnboarding();

  const [provider, setProvider] = useState<Provider>('claude');
  const [apiKey, setApiKey] = useState('');
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState(state.aiProvider?.validated ?? false);
  const [validatedModel, setValidatedModel] = useState(state.aiProvider?.model ?? '');
  const [error, setError] = useState('');
  const [autoDetected, setAutoDetected] = useState(false);

  // Auto-detect: env vars / vault
  const skipDetect = isReset || validated;
  const [envResult] = useQuery({
    query: DETECT_AI_CREDENTIAL_QUERY,
    requestPolicy: 'network-only',
    pause: skipDetect,
  });

  // Auto-detect: macOS Keychain (only runs after env detection completes without a match)
  const skipKeychain = skipDetect || envResult.fetching || !!envResult.data?.detectAiCredential;
  const [keychainResult] = useQuery({
    query: DETECT_KEYCHAIN_TOKEN_QUERY,
    requestPolicy: 'network-only',
    pause: skipKeychain,
  });

  const [, executeValidate] = useMutation(VALIDATE_AI_CREDENTIAL_MUTATION);

  // Handle env detection result
  useEffect(() => {
    const cred = envResult.data?.detectAiCredential;
    if (cred) {
      setAutoDetected(true);
      setValidated(true);
      setValidatedModel(cred.model || 'Claude');
      updateState({ aiProvider: { method: 'env-detected', model: cred.model, validated: true } });
    }
  }, [envResult.data, updateState]);

  // Handle keychain detection result
  useEffect(() => {
    const keychain = keychainResult.data?.detectKeychainToken;
    if (keychain?.found && !keychain.error) {
      const model = keychain.model || 'Claude (Keychain)';
      setAutoDetected(true);
      setValidated(true);
      setValidatedModel(model);
      updateState({ aiProvider: { method: 'keychain', model, validated: true } });
    }
  }, [keychainResult.data, updateState]);

  // Surface auto-detection errors as a non-blocking hint
  useEffect(() => {
    if (envResult.error || keychainResult.error) {
      setError('Could not auto-detect credentials — enter an API key manually.');
    }
  }, [envResult.error, keychainResult.error]);

  const handleSelectProvider = (p: Provider) => {
    if (p === provider) return;
    setProvider(p);
    setApiKey('');
    setError('');
    if (!autoDetected) {
      setValidated(false);
      setValidatedModel('');
    }
  };

  const handleValidateApiKey = useCallback(async () => {
    if (!apiKey.trim()) {
      setError('Please enter an API key');
      return;
    }
    setError('');
    setValidating(true);
    try {
      const result = await executeValidate({
        input: {
          method: 'API_KEY',
          apiKey: apiKey.trim(),
          provider: provider === 'openrouter' ? 'OPENROUTER' : provider === 'openai' ? 'OPENAI' : 'ANTHROPIC',
        },
      });
      if (result.error) {
        setError(result.error.message || 'Connection failed.');
        return;
      }
      const data = result.data?.validateAiCredential;
      if (data?.success) {
        setValidated(true);
        setValidatedModel(data.model || 'Claude');
        updateState({ aiProvider: { method: 'api-key', model: data.model, validated: true } });
      } else {
        setError(data?.error || 'Invalid API key.');
      }
    } catch {
      setError('Connection failed. Make sure the backend is running.');
    } finally {
      setValidating(false);
    }
  }, [apiKey, provider, updateState, executeValidate]);

  // ── Navigation ─────────────────────────────────────────────────────────────

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

            {/* Claude: API key only */}
            {!validated && provider === 'claude' && (
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
