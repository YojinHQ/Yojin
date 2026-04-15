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
          className="mb-12 text-center opacity-0 [animation:onboarding-fade-up_0.6s_ease-out_forwards]"
          style={{ animationDelay: '100ms' }}
        >
          <h1 className="font-headline text-4xl leading-tight text-text-primary sm:text-5xl">
            Take control of your finances.
          </h1>
        </div>

        {/* Value prop cards */}
        <div className="mb-12 grid w-full max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
          <ValuePropCard
            delay={350}
            icon={
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5m.75-9 3-3 2.148 2.148A12.061 12.061 0 0 1 16.5 7.605"
                />
              </svg>
            }
            title="Control and Monitor"
            description="Connect your portfolio and place trades. Yojin watches markets 24/7."
          />
          <ValuePropCard
            delay={500}
            icon={
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                />
              </svg>
            }
            title="Research Analyst"
            description="Yojin has access to the same financial data a human analyst would use."
          />
          <ValuePropCard
            delay={650}
            icon={
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
                />
              </svg>
            }
            title="Strategy Studio"
            description="Use natural language to define your strategy and boundaries."
          />
          <ValuePropCard
            delay={800}
            icon={
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
                />
              </svg>
            }
            title="Privacy and Security"
            description="Encrypted secrets, strips all sensitive data before it reaches the LLM."
          />
        </div>

        {/* CTA */}
        <div
          className="flex flex-col items-center gap-4 opacity-0 [animation:onboarding-fade-up_0.5s_ease-out_forwards]"
          style={{ animationDelay: '950ms' }}
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
