import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation } from 'urql';
import { useOnboarding } from '../../lib/onboarding-context';
import { OnboardingShell } from '../../components/onboarding/onboarding-shell';
import Button from '../../components/common/button';
import { COMPLETE_ONBOARDING_MUTATION } from '../../api/documents';
import { cn } from '../../lib/utils';

/* ─── Animated completion emblem ────────────────────────────────── */

const OUTER_R = 48;
const OUTER_C = 2 * Math.PI * OUTER_R;
const INNER_R = 38;
const INNER_C = 2 * Math.PI * INNER_R;
const CHECK_LEN = 60;

function CompletionEmblem() {
  return (
    <div className="relative flex items-center justify-center">
      {/* Radial ambient glow */}
      <div
        className="absolute h-56 w-56 rounded-full"
        style={{
          background: 'radial-gradient(circle, rgba(91,185,140,0.12) 0%, transparent 70%)',
          opacity: 0,
          animation: 'done-radial-glow 1s ease-out 0.9s forwards',
        }}
      />

      <svg
        viewBox="0 0 120 120"
        className="relative h-32 w-32"
        style={{ animation: 'done-emblem-glow 1.8s ease-out 1s both' }}
      >
        {/* Outer ring — draws clockwise from top, then breathes */}
        <circle
          cx="60"
          cy="60"
          r={OUTER_R}
          fill="none"
          stroke="var(--color-success)"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.5"
          strokeDasharray={OUTER_C}
          strokeDashoffset={OUTER_C}
          transform="rotate(-90 60 60)"
          style={{
            animation: 'done-draw-stroke 1s ease-out 0.15s forwards, done-ring-breathe 5s ease-in-out 1.5s infinite',
          }}
        />

        {/* Inner ring */}
        <circle
          cx="60"
          cy="60"
          r={INNER_R}
          fill="none"
          stroke="var(--color-success)"
          strokeWidth="0.5"
          opacity="0.25"
          strokeDasharray={INNER_C}
          strokeDashoffset={INNER_C}
          transform="rotate(-90 60 60)"
          style={{ animation: 'done-draw-stroke 0.8s ease-out 0.4s forwards' }}
        />

        {/* Checkmark — draws after rings */}
        <path
          d="M40 63 L53 76 L80 46"
          fill="none"
          stroke="var(--color-success)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={CHECK_LEN}
          strokeDashoffset={CHECK_LEN}
          style={{ animation: 'done-draw-stroke 0.5s ease-out 0.85s forwards' }}
        />
      </svg>
    </div>
  );
}

/* ─── Status LED row ────────────────────────────────────────────── */

interface StatusLedProps {
  active: boolean;
  label: string;
  detail: string;
  index: number;
}

const STATUS_BASE_DELAY = 1400;
const STATUS_STAGGER = 150;

function StatusLed({ active, label, detail, index }: StatusLedProps) {
  const delay = STATUS_BASE_DELAY + index * STATUS_STAGGER;

  return (
    <div
      className="flex items-center gap-3 px-5 py-3 opacity-0 [animation:onboarding-fade-up_0.4s_ease-out_forwards]"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* LED dot */}
      <div
        className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-bg-tertiary"
        style={active ? { animation: `done-led-on 0.3s ease-out ${delay + 200}ms forwards` } : undefined}
      />

      <span className={cn('text-sm', active ? 'text-text-primary' : 'text-text-muted')}>{label}</span>

      <span className={cn('ml-auto text-xs tabular-nums', active ? 'text-text-secondary' : 'text-text-muted')}>
        {detail}
      </span>
    </div>
  );
}

/* ─── Step 5: Done ──────────────────────────────────────────────── */

export function Step5Done() {
  const { state, completeOnboarding } = useOnboarding();
  const navigate = useNavigate();
  const [, executeComplete] = useMutation(COMPLETE_ONBOARDING_MUTATION);
  const [finishing, setFinishing] = useState(false);

  const handleFinish = (path: string) => {
    if (finishing) return;
    setFinishing(true);
    // Fire-and-forget: mark completed server-side (best-effort)
    executeComplete({});
    // Mark completed client-side (localStorage) and close modal
    completeOnboarding();
    navigate(path, { replace: true });
  };

  /* ── Derive summary from wizard state ── */

  const aiConnected = state.aiProvider?.validated ?? false;
  const aiDetail = state.aiProvider?.model || 'Claude';

  const persona = state.persona;
  const personaCreated = persona?.confirmed ?? false;
  const personaDetail = personaCreated && persona ? `${persona.name} · ${persona.riskTolerance}` : 'Skipped';

  const connected = state.platforms?.connected ?? [];
  const platformCount = connected.length;
  const platformsDetail = platformCount > 0 ? `${platformCount} platform${platformCount > 1 ? 's' : ''}` : 'Skipped';

  const briefing = state.briefing;
  const briefingConfigured = !!briefing;
  const briefingDetail =
    briefingConfigured && briefing
      ? `${formatTime(briefing.time)} ${briefing.timezone.split('/').pop()?.replace('_', ' ')}`
      : 'Skipped';

  const items: Omit<StatusLedProps, 'index'>[] = [
    { active: aiConnected, label: 'AI provider', detail: aiDetail },
    { active: personaCreated, label: 'Investor persona', detail: personaDetail },
    { active: platformCount > 0, label: 'Portfolio linked', detail: platformsDetail },
    { active: briefingConfigured, label: 'Daily briefing', detail: briefingDetail },
  ];

  return (
    <OnboardingShell currentStep={5}>
      <div className="flex w-full max-w-lg flex-col items-center">
        {/* ── Animated emblem ── */}
        <div className="mb-6">
          <CompletionEmblem />
        </div>

        {/* ── Headline ── */}
        <h1
          className="mb-2 font-headline text-4xl text-text-primary opacity-0 [animation:onboarding-fade-up_0.6s_ease-out_forwards]"
          style={{ animationDelay: '1000ms' }}
        >
          You're all set
        </h1>

        <p
          className="mb-8 text-center text-sm text-text-secondary opacity-0 [animation:onboarding-fade-up_0.5s_ease-out_forwards]"
          style={{ animationDelay: '1150ms' }}
        >
          Yojin is online and ready to work for you.
        </p>

        {/* ── Finish line — gradient divider ── */}
        <div
          className="mb-8 h-px w-full max-w-[200px]"
          style={{
            background: 'linear-gradient(to right, transparent, var(--color-success), transparent)',
            transform: 'scaleX(0)',
            opacity: 0,
            animation: 'done-line-extend 0.6s ease-out 1300ms forwards',
          }}
        />

        {/* ── Status board ── */}
        <div className="mb-10 w-full rounded-xl bg-black/20 py-1 ring-1 ring-white/[0.06]">
          {items.map((item, i) => (
            <StatusLed key={item.label} index={i} {...item} />
          ))}
        </div>

        {/* ── CTAs ── */}
        <div
          className="flex items-center justify-center gap-3 opacity-0 [animation:onboarding-fade-up_0.5s_ease-out_forwards]"
          style={{ animationDelay: '2100ms' }}
        >
          <Button
            variant="primary"
            size="lg"
            disabled={finishing}
            onClick={() => handleFinish('/')}
            className="px-8 shadow-[0_0_24px_rgba(255,90,94,0.2)]"
          >
            Enter dashboard
            <svg className="ml-1.5 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </Button>
          <Button
            variant="secondary"
            size="lg"
            disabled={finishing}
            onClick={() => handleFinish('/chat')}
            className="px-6"
          >
            Open chat
            <svg className="ml-1.5 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.2 48.2 0 0 0 5.887-.37c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.4 48.4 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z"
              />
            </svg>
          </Button>
        </div>
      </div>
    </OnboardingShell>
  );
}

/* ── Helpers ── */

function formatTime(time24: string): string {
  const [hStr, mStr] = time24.split(':');
  let h = parseInt(hStr, 10);
  const period = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${mStr} ${period}`;
}
