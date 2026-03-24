import { useOnboarding } from '../../lib/onboarding-context';
import { OnboardingShell } from '../../components/onboarding/onboarding-shell';
import { JintelKeyForm } from '../../components/jintel/jintel-key-form';
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

export function Step4Jintel() {
  const { updateState, nextStep } = useOnboarding();

  function handleSuccess() {
    updateState({ jintel: { configured: true, skipped: false } });
    setTimeout(() => nextStep(), 600);
  }

  function handleSkip() {
    updateState({ jintel: { configured: false, skipped: true } });
    nextStep();
  }

  return (
    <OnboardingShell currentStep={4}>
      <div className="w-full max-w-lg">
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

          <div className="space-y-3">
            <JintelKeyForm onSuccess={handleSuccess} />
            <p className="text-xs text-text-muted">
              Don&apos;t have a key?{' '}
              <a
                href="https://jintel.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-primary hover:underline"
              >
                Sign up at jintel.ai
              </a>
            </p>
          </div>

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
