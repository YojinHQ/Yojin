import { useTheme } from '../../lib/theme';
import { useOnboarding } from '../../lib/onboarding-context';
import { OnboardingShell } from '../../components/onboarding/onboarding-shell';
import { ValuePropCard } from '../../components/onboarding/value-prop-card';
import Button from '../../components/common/button';

export function Step0Welcome() {
  const { nextStep, skipOnboarding } = useOnboarding();
  const { resolved } = useTheme();
  const logoSrc = resolved === 'dark' ? '/brand/yojin_logo_white.png' : '/brand/yojin_logo.png';

  return (
    <OnboardingShell currentStep={0} showProgress={false}>
      <div className="flex w-full max-w-4xl flex-col items-center">
        {/* Logo */}
        <div
          className="mb-10 opacity-0 [animation:onboarding-fade-up_0.5s_ease-out_forwards]"
          style={{ animationDelay: '0ms' }}
        >
          <img
            src={logoSrc}
            alt="Yojin"
            className="h-8"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        </div>

        {/* Headline */}
        <div
          className="mb-4 text-center opacity-0 [animation:onboarding-fade-up_0.6s_ease-out_forwards]"
          style={{ animationDelay: '100ms' }}
        >
          <h1 className="font-headline text-4xl leading-tight text-text-primary sm:text-5xl">
            Your personal Bloomberg.
          </h1>
        </div>

        <p
          className="mb-12 text-center text-lg text-text-secondary opacity-0 [animation:onboarding-fade-up_0.6s_ease-out_forwards]"
          style={{ animationDelay: '200ms' }}
        >
          Built for you, running on your machine.
        </p>

        {/* Value prop cards */}
        <div className="mb-12 grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
          <ValuePropCard
            delay={350}
            icon={
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"
                />
              </svg>
            }
            title="Knows your portfolio"
            description="Connects to your platforms automatically and keeps your positions in sync."
          />
          <ValuePropCard
            delay={500}
            icon={
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
                />
              </svg>
            }
            title="Reasons like an analyst"
            description="Powered by Claude, not keyword matching. Gets smarter with your persona."
          />
          <ValuePropCard
            delay={650}
            icon={
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
                />
              </svg>
            }
            title="Runs locally"
            description="Your data never leaves your machine. Credentials stored in an encrypted vault."
          />
        </div>

        {/* CTA */}
        <div
          className="flex flex-col items-center gap-4 opacity-0 [animation:onboarding-fade-up_0.5s_ease-out_forwards]"
          style={{ animationDelay: '800ms' }}
        >
          <Button variant="primary" size="lg" onClick={nextStep} className="px-8">
            Set up Yojin
            <svg className="ml-1 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </Button>
          <button
            onClick={skipOnboarding}
            className="cursor-pointer text-sm text-text-muted transition-colors hover:text-text-secondary"
          >
            I'll do this later
          </button>
        </div>
      </div>
    </OnboardingShell>
  );
}
