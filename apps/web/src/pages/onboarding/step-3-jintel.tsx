import { useState, useCallback } from 'react';
import { useMutation } from 'urql';
import { useOnboarding } from '../../lib/onboarding-context';
import { OnboardingShell } from '../../components/onboarding/onboarding-shell';
import { VALIDATE_JINTEL_KEY_MUTATION } from '../../api/documents';
import type { ValidateJintelKeyMutationResult } from '../../api/types';
import Button from '../../components/common/button';
import Input from '../../components/common/input';
import Badge from '../../components/common/badge';
import { cn } from '../../lib/utils';

const WITHOUT_FEATURES = [
  'Basic RSS news only',
  'No live market quotes',
  'No risk screening signals',
  'No fundamentals enrichment',
];

const WITH_FEATURES = [
  'Real-time market quotes',
  'News with sentiment analysis',
  'Enriched fundamentals (P/E, beta, 52-week range)',
  'Risk screening and signals',
];

type Mode = null | 'enter-key' | 'sign-up';

export function Step3Jintel() {
  const { updateState, nextStep } = useOnboarding();

  const [mode, setMode] = useState<Mode>(null);
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [validated, setValidated] = useState(false);

  const [{ fetching }, validateKey] = useMutation<ValidateJintelKeyMutationResult>(VALIDATE_JINTEL_KEY_MUTATION);

  const handleValidate = useCallback(async () => {
    if (!apiKey.trim()) {
      setError('Please enter an API key');
      return;
    }
    setError('');

    const result = await validateKey({ apiKey: apiKey.trim() });

    if (result.data?.validateJintelKey.success) {
      setValidated(true);
      setError('');
      updateState({ jintel: { configured: true, skipped: false } });
      setTimeout(() => nextStep(), 600);
    } else {
      setError(result.data?.validateJintelKey.error ?? result.error?.message ?? 'Invalid API key.');
    }
  }, [apiKey, validateKey, updateState, nextStep]);

  function handleSkip() {
    updateState({ jintel: { configured: false, skipped: true } });
    nextStep();
  }

  return (
    <OnboardingShell currentStep={3}>
      <div className="w-full max-w-lg">
        {/* Header */}
        <div
          className="mb-8 text-center opacity-0 [animation:onboarding-fade-up_0.5s_ease-out_forwards]"
          style={{ animationDelay: '0ms' }}
        >
          <h1 className="mb-2 font-headline text-2xl text-text-primary">Connect Jintel Intelligence</h1>
          <p className="text-sm text-text-secondary">
            Jintel powers real-time market data, news sentiment, and risk screening for your portfolio.
          </p>
        </div>

        <div
          className="space-y-6 opacity-0 [animation:onboarding-fade-up_0.5s_ease-out_forwards]"
          style={{ animationDelay: '100ms' }}
        >
          {/* Feature comparison */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border bg-bg-secondary p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">Without Jintel</h3>
              <ul className="space-y-2">
                {WITHOUT_FEATURES.map((feat) => (
                  <li key={feat} className="flex items-start gap-2 text-xs text-text-secondary">
                    <span className="mt-0.5 text-text-muted">&#x2717;</span>
                    {feat}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-accent-primary/30 bg-accent-primary/5 p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-accent-primary">With Jintel</h3>
              <ul className="space-y-2">
                {WITH_FEATURES.map((feat) => (
                  <li key={feat} className="flex items-start gap-2 text-xs text-text-primary">
                    <span className="mt-0.5 text-success">&#x2713;</span>
                    {feat}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Mode selector cards */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setMode('enter-key')}
              className={cn(
                'relative cursor-pointer flex flex-col items-center gap-2 rounded-xl border p-5 transition-all duration-200',
                mode === 'enter-key'
                  ? 'border-accent-primary/60 bg-accent-glow'
                  : 'border-border bg-bg-card hover:border-accent-primary/30 hover:bg-bg-hover/60',
              )}
            >
              {/* Key icon */}
              <div
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
                  mode === 'enter-key' ? 'bg-accent-primary/20' : 'bg-bg-tertiary',
                )}
              >
                <svg
                  className={cn('h-4.5 w-4.5', mode === 'enter-key' ? 'text-accent-primary' : 'text-text-muted')}
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
              </div>
              <div className="text-center">
                <p
                  className={cn(
                    'text-sm font-medium',
                    mode === 'enter-key' ? 'text-text-primary' : 'text-text-secondary',
                  )}
                >
                  I have a key
                </p>
                <p className="mt-0.5 text-xs text-text-muted">Enter your API key</p>
              </div>
              {mode === 'enter-key' && (
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
              {mode !== 'enter-key' && (
                <div className="absolute top-3 right-3 h-4 w-4 rounded-full border-2 border-border-light" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setMode('sign-up')}
              className={cn(
                'relative cursor-pointer flex flex-col items-center gap-2 rounded-xl border p-5 transition-all duration-200',
                mode === 'sign-up'
                  ? 'border-accent-primary/60 bg-accent-glow'
                  : 'border-border bg-bg-card hover:border-accent-primary/30 hover:bg-bg-hover/60',
              )}
            >
              {/* User-plus icon */}
              <div
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
                  mode === 'sign-up' ? 'bg-accent-primary/20' : 'bg-bg-tertiary',
                )}
              >
                <svg
                  className={cn('h-4.5 w-4.5', mode === 'sign-up' ? 'text-accent-primary' : 'text-text-muted')}
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z"
                  />
                </svg>
              </div>
              <div className="text-center">
                <p
                  className={cn(
                    'text-sm font-medium',
                    mode === 'sign-up' ? 'text-text-primary' : 'text-text-secondary',
                  )}
                >
                  New to Jintel
                </p>
                <p className="mt-0.5 text-xs text-text-muted">Create a free account</p>
              </div>
              {mode === 'sign-up' && (
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
              {mode !== 'sign-up' && (
                <div className="absolute top-3 right-3 h-4 w-4 rounded-full border-2 border-border-light" />
              )}
            </button>
          </div>

          {/* Enter key form */}
          {mode === 'enter-key' && (
            <div className="rounded-xl border border-border bg-bg-card p-5 [animation:onboarding-fade-up_0.3s_ease-out_forwards]">
              {validated ? (
                <div className="flex items-center gap-3">
                  <Badge variant="success" size="sm">
                    Connected
                  </Badge>
                  <span className="text-sm text-text-secondary">Jintel Intelligence</span>
                </div>
              ) : (
                <div className="space-y-3">
                  <Input
                    label="Jintel API key"
                    type="password"
                    placeholder="jntl_..."
                    hint="api.jintel.ai"
                    autoComplete="new-password"
                    name="jintel-key-onboarding"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    error={error || undefined}
                    size="md"
                    onKeyDown={(e) => e.key === 'Enter' && handleValidate()}
                  />
                  <Button
                    variant="primary"
                    size="md"
                    loading={fetching}
                    disabled={!apiKey.trim()}
                    onClick={handleValidate}
                    className="w-full"
                  >
                    Verify key
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Sign up flow */}
          {mode === 'sign-up' && (
            <div className="rounded-xl border border-border bg-bg-card p-5 [animation:onboarding-fade-up_0.3s_ease-out_forwards]">
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="text-sm text-text-secondary">
                    Create your free Jintel account, then come back and enter your API key.
                  </p>
                  <ol className="space-y-1.5">
                    <li className="flex gap-2.5 text-xs text-text-secondary">
                      <span className="flex h-4.5 w-4.5 flex-shrink-0 items-center justify-center rounded-full bg-bg-tertiary text-3xs font-medium text-text-muted">
                        1
                      </span>
                      Sign up at api.jintel.ai
                    </li>
                    <li className="flex gap-2.5 text-xs text-text-secondary">
                      <span className="flex h-4.5 w-4.5 flex-shrink-0 items-center justify-center rounded-full bg-bg-tertiary text-3xs font-medium text-text-muted">
                        2
                      </span>
                      Copy your API key from the dashboard
                    </li>
                    <li className="flex gap-2.5 text-xs text-text-secondary">
                      <span className="flex h-4.5 w-4.5 flex-shrink-0 items-center justify-center rounded-full bg-bg-tertiary text-3xs font-medium text-text-muted">
                        3
                      </span>
                      Come back and select &ldquo;I have a key&rdquo;
                    </li>
                  </ol>
                </div>
                <a
                  href="https://api.jintel.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-primary/90"
                >
                  Go to api.jintel.ai
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                    />
                  </svg>
                </a>
              </div>
            </div>
          )}

          {/* Skip */}
          <div className="pt-2 text-center">
            <button
              type="button"
              onClick={handleSkip}
              className={cn('text-xs text-text-muted transition-colors hover:text-text-secondary')}
            >
              Skip for now
            </button>
          </div>
        </div>
      </div>
    </OnboardingShell>
  );
}
