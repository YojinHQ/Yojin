import { OnboardingProvider, useOnboarding } from '../lib/onboarding-context';
import { Step0Welcome } from './onboarding/step-0-welcome';
import { Step1AiBrain } from './onboarding/step-1-ai-brain';
import { Step2Persona } from './onboarding/step-2-persona';
import { Step3Platforms } from './onboarding/step-3-platforms';
import { Step4Briefing } from './onboarding/step-4-briefing';
import { Step5Done } from './onboarding/step-5-done';

function OnboardingRouter() {
  const { currentStep } = useOnboarding();

  switch (currentStep) {
    case 0:
      return <Step0Welcome />;
    case 1:
      return <Step1AiBrain />;
    case 2:
      return <Step2Persona />;
    case 3:
      return <Step3Platforms />;
    case 4:
      return <Step4Briefing />;
    case 5:
      return <Step5Done />;
    default:
      return <Step0Welcome />;
  }
}

export default function OnboardingPage() {
  return (
    <OnboardingProvider>
      <OnboardingRouter />
    </OnboardingProvider>
  );
}
