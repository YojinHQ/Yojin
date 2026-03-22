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

type AuthMode = 'magic-link' | 'api-key';

export function Step1AiBrain() {
  const { state, updateState, nextStep, prevStep, isReset } = useOnboarding();

  const [provider, setProvider] = useState<Provider>('claude');
  const [authMode, setAuthMode] = useState<AuthMode>('magic-link');
  const [apiKey, setApiKey] = useState('');
  const [email, setEmail] = useState('');
  const [magicLinkUrl, setMagicLinkUrl] = useState('');
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState(state.aiProvider?.validated ?? false);
  const [validatedModel, setValidatedModel] = useState(state.aiProvider?.model ?? '');
  const [error, setError] = useState('');
  const [envDetected, setEnvDetected] = useState(false);

  // Check for env-detected credential on mount
  useEffect(() => {
    let cancelled = false;
    async function detect() {
      try {
        const res = await fetch('/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: '{ detectAiCredential { method model } }' }),
        });
        const json = await res.json();
        const cred = json?.data?.detectAiCredential;
        if (!cancelled && cred) {
          setEnvDetected(true);
          setValidated(true);
          setValidatedModel(cred.model || 'Claude');
          updateState({ aiProvider: { method: 'env-detected', model: cred.model, validated: true } });
        }
      } catch {
        // No env credential
      }
    }
    if (!isReset && !validated) detect();
    return () => {
      cancelled = true;
    };
  }, [isReset, validated, updateState]);

  const handleSelectProvider = (p: Provider) => {
    if (p === provider) return;
    setProvider(p);
    setAuthMode(p === 'claude' ? 'magic-link' : 'api-key');
    setApiKey('');
    setEmail('');
    setMagicLinkUrl('');
    setMagicLinkSent(false);
    setVerifying(false);
    setError('');
    if (!envDetected) {
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

  const handleSendMagicLink = useCallback(async () => {
    if (!email.trim()) {
      setError('Please enter your email');
      return;
    }
    setError('');
    setValidating(true);
    try {
      const res = await fetch('/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `mutation ($email: String!) { sendMagicLink(email: $email) { success error } }`,
          variables: { email: email.trim() },
        }),
      });
      const json = await res.json();
      const result = json?.data?.sendMagicLink;
      if (result?.success) {
        setMagicLinkSent(true);
      } else {
        setError(result?.error || 'Failed to send verification email.');
      }
    } catch {
      setError('Connection failed. Make sure the backend is running.');
    } finally {
      setValidating(false);
    }
  }, [email]);

  const handleCompleteMagicLink = useCallback(async () => {
    if (!magicLinkUrl.trim()) return;
    setError('');
    setVerifying(true);
    setValidating(true);
    try {
      const res = await fetch('/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `mutation ($magicLinkUrl: String!) { completeMagicLink(magicLinkUrl: $magicLinkUrl) { success model error } }`,
          variables: { magicLinkUrl: magicLinkUrl.trim() },
        }),
      });
      const json = await res.json();
      const result = json?.data?.completeMagicLink;
      if (result?.success) {
        setValidated(true);
        setValidatedModel(result.model || 'Claude');
        updateState({ aiProvider: { method: 'magic-link', model: result.model, validated: true } });
        setVerifying(false);
      } else {
        setError(result?.error || 'Failed to complete authentication. Try again.');
        setVerifying(false);
      }
    } catch {
      setError('Connection failed.');
      setVerifying(false);
    } finally {
      setValidating(false);
    }
  }, [magicLinkUrl, updateState]);

  const handleContinue = () => {
    if (validated) nextStep();
  };

  // Env-detected banner
  if (envDetected && validated) {
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

            {/* Claude: Magic link or API key toggle */}
            {!validated && provider === 'claude' && (
              <div className="space-y-4">
                {/* Auth mode toggle */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('magic-link');
                      setError('');
                    }}
                    className={cn(
                      'cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                      authMode === 'magic-link'
                        ? 'bg-bg-tertiary text-text-primary'
                        : 'text-text-muted hover:bg-bg-hover/50 hover:text-text-secondary',
                    )}
                  >
                    Email verification
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

                {/* Magic link — enter email */}
                {authMode === 'magic-link' && !magicLinkSent && !verifying && (
                  <div className="space-y-3">
                    <p className="text-xs text-text-muted">
                      Enter your Anthropic account email. We'll trigger a magic link from Claude.
                    </p>
                    <Input
                      label="Email address"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      error={error || undefined}
                      size="md"
                      onKeyDown={(e) => e.key === 'Enter' && handleSendMagicLink()}
                    />
                    <Button
                      variant="primary"
                      size="md"
                      loading={validating}
                      disabled={!email.trim()}
                      onClick={handleSendMagicLink}
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
                          d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"
                        />
                      </svg>
                      Send magic link
                    </Button>
                  </div>
                )}

                {/* Magic link — paste URL */}
                {authMode === 'magic-link' && magicLinkSent && !verifying && (
                  <div className="space-y-3">
                    <div className="rounded-lg bg-bg-tertiary/50 p-3">
                      <p className="mb-1.5 text-xs font-medium text-text-primary">Check your email for a magic link</p>
                      <p className="text-[11px] leading-relaxed text-text-muted">
                        1. Open the email from Anthropic
                        <br />
                        2. Right-click the link &rarr; <span className="text-text-secondary">Copy Link Address</span>
                        <br />
                        3. Paste it below
                      </p>
                    </div>
                    <Input
                      label="Magic link URL"
                      type="url"
                      placeholder="https://claude.ai/magic-link#..."
                      value={magicLinkUrl}
                      onChange={(e) => setMagicLinkUrl(e.target.value)}
                      error={error || undefined}
                      size="md"
                      onKeyDown={(e) => e.key === 'Enter' && handleCompleteMagicLink()}
                    />
                    <Button
                      variant="primary"
                      size="md"
                      loading={validating}
                      disabled={!magicLinkUrl.trim()}
                      onClick={handleCompleteMagicLink}
                      className="w-full"
                    >
                      Complete setup
                    </Button>
                    <button
                      type="button"
                      onClick={() => {
                        setMagicLinkSent(false);
                        setMagicLinkUrl('');
                        setError('');
                      }}
                      className="cursor-pointer w-full text-center text-xs text-text-muted transition-colors hover:text-text-secondary"
                    >
                      Use a different email
                    </button>
                  </div>
                )}

                {/* Verifying progress */}
                {authMode === 'magic-link' && verifying && (
                  <div className="flex flex-col items-center gap-3 py-4">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-primary border-t-transparent" />
                    <div className="text-center">
                      <p className="text-sm font-medium text-text-primary">Completing authentication…</p>
                      <p className="mt-1 text-xs text-text-muted">
                        This may take up to 30 seconds. Do not close this page.
                      </p>
                    </div>
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
