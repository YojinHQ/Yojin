import { useQuery } from 'urql';
import { OnboardingProvider, useOnboarding, useOnboardingStatus } from '../lib/onboarding-context';
import { ONBOARDING_STATUS_QUERY } from '../api/documents';
import type { OnboardingStatusQueryResult } from '../api/types';
import { Step0Welcome } from './onboarding/step-0-welcome';
import { Step1AiBrain } from './onboarding/step-1-ai-brain';
import { Step2Persona } from './onboarding/step-2-persona';
import { Step3Jintel } from './onboarding/step-3-jintel';
import { Step4Platforms } from './onboarding/step-4-platforms';
import { Step5Briefing } from './onboarding/step-5-briefing';
import { Step6Done } from './onboarding/step-6-done';

/**
 * Determines the first incomplete onboarding step based on backend status.
 * Only resumes mid-flow if onboarding was never fully completed — otherwise
 * the user already finished and shouldn't land here (OnboardingGuard handles that).
 *
 * Returns undefined to start from step 0 (fresh / reset).
 */
function resolveResumeStep(status: OnboardingStatusQueryResult['onboardingStatus'] | undefined): number | undefined {
  if (!status) return undefined;

  // If onboarding was completed, the guard should have redirected — but just in case
  if (status.completed) return 6;

  // Only resume if the user actually went through onboarding steps (persona confirmed).
  // Env-var auto-detection alone is not "progress" — the user never interacted with the flow.
  if (!status.personaExists) return undefined;

  // Persona exists but onboarding wasn't completed — resume at first missing step.
  // AI provider comes before persona in the flow, so re-check it: a user can complete
  // persona, then later clear/invalidate their AI credential, and we should send them
  // back to AI Brain instead of skipping ahead to Jintel/Platforms.
  if (!status.aiCredentialConfigured) return 1;
  if (!status.jintelConfigured) return 3;
  if (status.connectedPlatforms.length === 0) return 4;
  if (!status.briefingConfigured) return 5;

  return 6;
}

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
      return <Step3Jintel />;
    case 4:
      return <Step4Platforms />;
    case 5:
      return <Step5Briefing />;
    case 6:
      return <Step6Done />;
    default:
      return <Step0Welcome />;
  }
}

export default function OnboardingPage() {
  const { isReset } = useOnboardingStatus();

  const [result] = useQuery<OnboardingStatusQueryResult>({
    query: ONBOARDING_STATUS_QUERY,
    pause: isReset,
    requestPolicy: 'network-only',
  });

  // Full reset — start from step 0, skip backend check
  if (isReset) {
    return (
      <OnboardingProvider initialStep={0} isReset>
        <OnboardingRouter />
      </OnboardingProvider>
    );
  }

  // Wait for the backend check before rendering
  if (result.fetching) return null;

  const resumeStep = resolveResumeStep(result.data?.onboardingStatus);

  return (
    <OnboardingProvider initialStep={resumeStep}>
      <OnboardingRouter />
    </OnboardingProvider>
  );
}
