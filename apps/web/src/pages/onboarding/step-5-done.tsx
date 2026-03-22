import { useNavigate } from 'react-router';
import { useMutation } from 'urql';
import { useOnboarding } from '../../lib/onboarding-context';
import { OnboardingShell } from '../../components/onboarding/onboarding-shell';
import { SummaryRow } from '../../components/onboarding/summary-row';
import Button from '../../components/common/button';
import { COMPLETE_ONBOARDING_MUTATION } from '../../api/documents';

export function Step5Done() {
  const { state, completeOnboarding } = useOnboarding();
  const navigate = useNavigate();
  const [, executeComplete] = useMutation(COMPLETE_ONBOARDING_MUTATION);

  const handleFinish = async (path: string) => {
    // Mark completed server-side (persistent flag file)
    await executeComplete({});
    // Mark completed client-side (localStorage)
    completeOnboarding();
    navigate(path, { replace: true });
  };

  // Build summary data from wizard state
  const aiConnected = state.aiProvider?.validated ?? false;
  const aiDetail = state.aiProvider?.model || 'Claude';

  const persona = state.persona;
  const personaCreated = persona?.confirmed ?? false;
  const personaDetail =
    personaCreated && persona
      ? `${persona.name} — ${persona.riskTolerance}, ${persona.assetClasses.join(' + ')}, ${persona.communicationStyle}`
      : 'Skipped';

  const connected = state.platforms?.connected ?? [];
  const platformCount = connected.length;
  const platformsDetail =
    platformCount > 0
      ? `${platformCount} platform${platformCount > 1 ? 's' : ''} (${connected.map((p) => p.platform.replace('_', ' ')).join(', ')})`
      : 'Skipped';

  const briefing = state.briefing;
  const briefingConfigured = !!briefing;
  const briefingDetail =
    briefingConfigured && briefing
      ? `${formatTime(briefing.time)} ${briefing.timezone.split('/').pop()?.replace('_', ' ')}`
      : 'Skipped';

  return (
    <OnboardingShell currentStep={5}>
      <div className="w-full max-w-lg">
        {/* Header */}
        <div
          className="mb-8 text-center opacity-0 [animation:onboarding-fade-up_0.6s_ease-out_forwards]"
          style={{ animationDelay: '0ms' }}
        >
          <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-success/10">
            <svg className="h-7 w-7 text-success" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
          <h1 className="mb-2 font-headline text-3xl text-text-primary">You're all set</h1>
          <p className="text-sm text-text-secondary">Yojin is configured and ready to work for you.</p>
        </div>

        {/* Summary card */}
        <div
          className="mb-8 divide-y divide-border rounded-xl border border-border bg-bg-card px-5 opacity-0 [animation:onboarding-fade-up_0.5s_ease-out_forwards]"
          style={{ animationDelay: '150ms' }}
        >
          <SummaryRow completed={aiConnected} label="Claude connected" detail={aiDetail} />
          <SummaryRow completed={personaCreated} label="Persona created" detail={personaDetail} />
          <SummaryRow completed={platformCount > 0} label="Platforms connected" detail={platformsDetail} />
          <SummaryRow completed={briefingConfigured} label="Morning briefing" detail={briefingDetail} />
        </div>

        {/* CTAs */}
        <div
          className="flex items-center justify-center gap-3 opacity-0 [animation:onboarding-fade-up_0.5s_ease-out_forwards]"
          style={{ animationDelay: '300ms' }}
        >
          <Button variant="primary" size="lg" onClick={() => handleFinish('/')} className="px-6">
            Go to dashboard
            <svg className="ml-1.5 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </Button>
          <Button variant="secondary" size="lg" onClick={() => handleFinish('/chat')} className="px-6">
            Open chat
            <svg className="ml-1.5 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z"
              />
            </svg>
          </Button>
        </div>
      </div>
    </OnboardingShell>
  );
}

function formatTime(time24: string): string {
  const [hStr, mStr] = time24.split(':');
  let h = parseInt(hStr, 10);
  const period = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${mStr} ${period}`;
}
