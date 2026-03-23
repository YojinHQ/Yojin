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

type AuthMode = 'api-key' | 'oauth';

export function Step1AiBrain() {
  const { state, updateState, nextStep, prevStep, isReset } = useOnboarding();

  const [provider, setProvider] = useState<Provider>('claude');
  const [authMode, setAuthMode] = useState<AuthMode>('oauth');
  const [apiKey, setApiKey] = useState('');
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState(state.aiProvider?.validated ?? false);
  const [validatedModel, setValidatedModel] = useState(state.aiProvider?.model ?? '');
  const [error, setError] = useState('');
  const [autoDetected, setAutoDetected] = useState(false);

  // OAuth flow state
  const [oauthMode, setOauthMode] = useState<'choose' | 'browser' | 'magic_link' | 'magic_link_waiting'>('choose');
  const [authCode, setAuthCode] = useState('');
  const [oauthEmail, setOauthEmail] = useState('');
  const [oauthState, setOauthState] = useState('');
  const [magicLinkUrl, setMagicLinkUrl] = useState('');

  // Auto-detect credentials from env vars, vault, and macOS Keychain on mount.
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
        if (!cancelled && keychain?.found && !keychain.error) {
          const model = keychain.model || 'Claude (Keychain)';
          setAutoDetected(true);
          setValidated(true);
          setValidatedModel(model);
          updateState({ aiProvider: { method: 'keychain', model, validated: true } });
        }
      } catch {
        // No keychain token
      }
    }

    if (!isReset && !validated) {
      detectEnv().then(() => {
        if (!cancelled) detectKeychain();
      });
    }

    return () => {
      cancelled = true;
    };
  }, [isReset, validated, updateState]);

  const handleSelectProvider = (p: Provider) => {
    if (p === provider) return;
    setProvider(p);
    setAuthMode(p === 'claude' ? 'oauth' : 'api-key');
    setApiKey('');
    setError('');
    setOauthMode('choose');
    setAuthCode('');
    setOauthEmail('');
    setOauthState('');
    setMagicLinkUrl('');
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

  // ── Browser OAuth PKCE handlers ────────────────────────────────────────────

  const handleOpenBrowserOAuth = useCallback(async () => {
    setError('');
    setValidating(true);
    try {
      const res = await fetch('/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `mutation { startOAuthFlow { authUrl state } }`,
        }),
      });
      const json = await res.json();
      const result = json?.data?.startOAuthFlow;
      if (result?.authUrl) {
        window.open(result.authUrl, '_blank', 'noopener,noreferrer');
        setOauthState(result.state);
        setOauthMode('browser');
        setAuthCode('');
      } else {
        setError('Failed to generate authorization URL.');
      }
    } catch {
      setError('Connection failed. Make sure the backend is running.');
    } finally {
      setValidating(false);
    }
  }, []);

  const handleSubmitAuthCode = useCallback(async () => {
    const code = authCode.trim();
    if (!code) {
      setError('Please paste the authorization code.');
      return;
    }
    setError('');
    setValidating(true);
    try {
      const res = await fetch('/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `mutation ($code: String!, $state: String!) { completeOAuthFlow(code: $code, state: $state) { success model error } }`,
          variables: { code, state: oauthState },
        }),
      });
      const json = await res.json();
      const result = json?.data?.completeOAuthFlow;
      if (result?.success) {
        setValidated(true);
        setValidatedModel(result.model || 'Claude (OAuth)');
        updateState({ aiProvider: { method: 'oauth', model: result.model || 'Claude (OAuth)', validated: true } });
        setOauthMode('choose');
        setAuthCode('');
      } else {
        setError(result?.error || 'Failed to exchange authorization code.');
      }
    } catch {
      setError('Connection failed. Make sure the backend is running.');
    } finally {
      setValidating(false);
    }
  }, [authCode, oauthState, updateState]);

  const handleCancelOAuth = useCallback(() => {
    setOauthMode('choose');
    setAuthCode('');
    setOauthEmail('');
    setOauthState('');
    setMagicLinkUrl('');
    setError('');
  }, []);

  /** Magic link: launch server-side Playwright browser to enter email on Claude's login page. */
  const handleMagicLinkStart = useCallback(async () => {
    const email = oauthEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address.');
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
          variables: { email },
        }),
      });
      const json = await res.json();
      const result = json?.data?.sendMagicLink;
      if (result?.success) {
        setOauthMode('magic_link_waiting');
        setMagicLinkUrl('');
      } else {
        setError(result?.error || 'Failed to send magic link.');
      }
    } catch {
      setError('Connection failed. Make sure the backend is running.');
    } finally {
      setValidating(false);
    }
  }, [oauthEmail]);

  /** Complete magic link flow: user pastes the magic link URL from their email. */
  const handleSubmitMagicLink = useCallback(async () => {
    const url = magicLinkUrl.trim();
    if (!url) {
      setError('Please paste the magic link URL from your email.');
      return;
    }
    setError('');
    setValidating(true);
    try {
      const res = await fetch('/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `mutation ($magicLinkUrl: String!) { completeMagicLink(magicLinkUrl: $magicLinkUrl) { success model error } }`,
          variables: { magicLinkUrl: url },
        }),
      });
      const json = await res.json();
      const result = json?.data?.completeMagicLink;
      if (result?.success) {
        setValidated(true);
        setValidatedModel(result.model || 'Claude (OAuth)');
        updateState({ aiProvider: { method: 'oauth', model: result.model || 'Claude (OAuth)', validated: true } });
        setOauthMode('choose');
        setMagicLinkUrl('');
      } else {
        setError(result?.error || 'Failed to complete magic link flow.');
      }
    } catch {
      setError('Connection failed. Make sure the backend is running.');
    } finally {
      setValidating(false);
    }
  }, [magicLinkUrl, updateState]);

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

            {/* Claude: OAuth or API key */}
            {!validated && provider === 'claude' && (
              <div className="space-y-4">
                {/* Auth mode toggle */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('oauth');
                      setError('');
                    }}
                    className={cn(
                      'cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                      authMode === 'oauth'
                        ? 'bg-bg-tertiary text-text-primary'
                        : 'text-text-muted hover:bg-bg-hover/50 hover:text-text-secondary',
                    )}
                  >
                    OAuth
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

                {/* OAuth flow */}
                {authMode === 'oauth' && (
                  <div className="space-y-3">
                    {/* Choose: browser sign-in or magic link */}
                    {oauthMode === 'choose' && (
                      <>
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
                                d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
                              />
                            </svg>
                            <p className="text-xs font-medium text-text-primary">Sign in with Claude</p>
                          </div>
                          <p className="text-[11px] leading-relaxed text-text-muted">
                            Authorize Yojin to use your Claude account. No API key needed.
                          </p>
                        </div>
                        <Button
                          variant="primary"
                          size="md"
                          loading={validating}
                          onClick={handleOpenBrowserOAuth}
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
                              d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                            />
                          </svg>
                          Open in browser
                        </Button>
                        <div className="relative flex items-center gap-3">
                          <div className="h-px flex-1 bg-border" />
                          <span className="text-[10px] uppercase tracking-wider text-text-muted">or</span>
                          <div className="h-px flex-1 bg-border" />
                        </div>
                        <Button
                          variant="secondary"
                          size="md"
                          onClick={() => {
                            setOauthMode('magic_link');
                            setError('');
                          }}
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
                          Use magic link instead
                        </Button>
                        {error && <p className="text-xs text-error">{error}</p>}
                      </>
                    )}

                    {/* Magic link: enter email to trigger server-side flow */}
                    {oauthMode === 'magic_link' && (
                      <>
                        <div className="rounded-lg bg-bg-tertiary/50 p-3">
                          <p className="text-[11px] leading-relaxed text-text-muted">
                            Enter your Anthropic email. We'll submit it to Claude's login page and you'll receive a
                            magic link in your inbox. Paste the link back here to complete sign-in.
                          </p>
                        </div>
                        <Input
                          label="Anthropic email"
                          type="email"
                          placeholder="you@example.com"
                          hint="The email you use to log in to claude.ai"
                          value={oauthEmail}
                          onChange={(e) => setOauthEmail(e.target.value)}
                          error={error || undefined}
                          size="md"
                          onKeyDown={(e) => e.key === 'Enter' && handleMagicLinkStart()}
                        />
                        <div className="flex gap-2">
                          <Button
                            variant="primary"
                            size="md"
                            loading={validating}
                            disabled={!oauthEmail.trim()}
                            onClick={handleMagicLinkStart}
                            className="flex-1"
                          >
                            Send magic link
                          </Button>
                          <Button variant="secondary" size="md" onClick={handleCancelOAuth}>
                            Back
                          </Button>
                        </div>
                      </>
                    )}

                    {/* Magic link waiting: paste the URL from the email */}
                    {oauthMode === 'magic_link_waiting' && (
                      <>
                        <div className="rounded-lg border border-accent-primary/20 bg-accent-primary/[0.04] p-3">
                          <p className="mb-2 text-xs font-medium text-text-primary">Check your email</p>
                          <div className="space-y-1 text-[11px] leading-relaxed text-text-muted">
                            <p>1. Anthropic sent a magic link to your email</p>
                            <p>2. Open the email and copy the magic link URL</p>
                            <p>3. Paste the full URL below</p>
                          </div>
                        </div>
                        <Input
                          label="Magic link URL"
                          type="text"
                          placeholder="https://claude.ai/magic-link/..."
                          value={magicLinkUrl}
                          onChange={(e) => setMagicLinkUrl(e.target.value)}
                          error={error || undefined}
                          size="md"
                          onKeyDown={(e) => e.key === 'Enter' && handleSubmitMagicLink()}
                        />
                        <div className="flex gap-2">
                          <Button
                            variant="primary"
                            size="md"
                            loading={validating}
                            disabled={!magicLinkUrl.trim()}
                            onClick={handleSubmitMagicLink}
                            className="flex-1"
                          >
                            Verify link
                          </Button>
                          <Button variant="secondary" size="md" onClick={handleCancelOAuth}>
                            Cancel
                          </Button>
                        </div>
                      </>
                    )}

                    {/* Paste authorization code (shared by both flows) */}
                    {oauthMode === 'browser' && (
                      <>
                        <div className="rounded-lg border border-accent-primary/20 bg-accent-primary/[0.04] p-3">
                          <p className="mb-2 text-xs font-medium text-text-primary">Authorize in your browser</p>
                          <div className="space-y-1 text-[11px] leading-relaxed text-text-muted">
                            <p>1. A new tab opened with the Claude authorization page</p>
                            <p>
                              2. Sign in if needed, then click{' '}
                              <strong className="text-text-secondary">Authorize</strong>
                            </p>
                            <p>3. Copy the code from the redirect page and paste it below</p>
                          </div>
                        </div>
                        <Input
                          label="Authorization code"
                          type="text"
                          placeholder="Paste the code from the redirect page"
                          value={authCode}
                          onChange={(e) => setAuthCode(e.target.value)}
                          error={error || undefined}
                          size="md"
                          onKeyDown={(e) => e.key === 'Enter' && handleSubmitAuthCode()}
                        />
                        <div className="flex gap-2">
                          <Button
                            variant="primary"
                            size="md"
                            loading={validating}
                            disabled={!authCode.trim()}
                            onClick={handleSubmitAuthCode}
                            className="flex-1"
                          >
                            Verify code
                          </Button>
                          <Button variant="secondary" size="md" onClick={handleCancelOAuth}>
                            Cancel
                          </Button>
                        </div>
                      </>
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
