import { useState, useCallback, useEffect } from 'react';
import { useOnboarding } from '../../lib/onboarding-context';
import { OnboardingShell } from '../../components/onboarding/onboarding-shell';
import { TimePicker } from '../../components/onboarding/time-picker';
import { TimezonePicker } from '../../components/onboarding/timezone-picker';
import Toggle from '../../components/common/toggle';
import Button from '../../components/common/button';
import { cn } from '../../lib/utils';
import { setTimezone as persistTimezone } from '../../lib/timezone';

interface DigestSection {
  key: string;
  label: string;
  description: string;
  defaultOn: boolean;
}

const DIGEST_SECTIONS: DigestSection[] = [
  {
    key: 'portfolio-performance',
    label: 'Portfolio performance',
    description: 'Change since yesterday',
    defaultOn: true,
  },
  {
    key: 'top-movers',
    label: 'Top movers',
    description: 'Biggest gainers and losers in your holdings',
    defaultOn: true,
  },
  {
    key: 'earnings-calendar',
    label: 'Earnings calendar',
    description: 'Upcoming earnings for your positions',
    defaultOn: true,
  },
  {
    key: 'analyst-ratings',
    label: 'Analyst rating changes',
    description: 'Upgrades and downgrades on your positions',
    defaultOn: true,
  },
  {
    key: 'insider-activity',
    label: 'Insider activity',
    description: 'Insider buys and sells in your holdings',
    defaultOn: false,
  },
  { key: 'market-sentiment', label: 'Market sentiment', description: 'Overall market mood and VIX', defaultOn: false },
  { key: 'macro-events', label: 'Macro events', description: 'Fed decisions, CPI releases, etc.', defaultOn: false },
];

function getDefaultSections(): string[] {
  return DIGEST_SECTIONS.filter((s) => s.defaultOn).map((s) => s.key);
}

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'America/New_York';
  }
}

export function Step4Briefing() {
  const { state, updateState, nextStep, prevStep } = useOnboarding();

  const [time, setTime] = useState(state.briefing?.time ?? '08:00');
  const [timezone, setTimezone] = useState(state.briefing?.timezone ?? detectTimezone());
  const [sections, setSections] = useState<string[]>(state.briefing?.sections ?? getDefaultSections());
  const channel = 'web';
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Persist timezone to localStorage so the header clock can use it
  useEffect(() => {
    persistTimezone(timezone);
  }, [timezone]);

  const toggleSection = (key: string) => {
    setSections((prev) => (prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]));
  };

  const handleContinue = useCallback(async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `mutation ($input: BriefingConfigInput!) { saveBriefingConfig(input: $input) }`,
          variables: {
            input: { time, timezone, sections, channel },
          },
        }),
      });
      const json = await res.json();
      if (json?.data?.saveBriefingConfig) {
        updateState({ briefing: { time, timezone, sections, channel: 'web' as const } });
        nextStep();
      } else {
        setError('Failed to save config. Try again.');
      }
    } catch {
      setError('Connection failed.');
    } finally {
      setSaving(false);
    }
  }, [time, timezone, sections, updateState, nextStep]);

  return (
    <OnboardingShell currentStep={4}>
      <div className="w-full max-w-lg">
        {/* Header */}
        <div
          className="mb-8 text-center opacity-0 [animation:onboarding-fade-up_0.5s_ease-out_forwards]"
          style={{ animationDelay: '0ms' }}
        >
          <h1 className="mb-2 font-headline text-2xl text-text-primary">Your daily briefing</h1>
          <p className="text-sm text-text-secondary">Yojin sends a morning digest with everything you need to know.</p>
        </div>

        <div
          className="space-y-8 opacity-0 [animation:onboarding-fade-up_0.5s_ease-out_forwards]"
          style={{ animationDelay: '100ms' }}
        >
          {/* Section 1: Schedule */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-text-secondary">When should I send it?</p>
            <div className="flex items-center gap-4">
              <TimePicker value={time} onChange={setTime} />
              <TimezonePicker value={timezone} onChange={setTimezone} />
            </div>
          </div>

          {/* Section 2: Content */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-text-secondary">What should it include?</p>
            <div className="divide-y divide-border rounded-xl border border-border bg-bg-card">
              {DIGEST_SECTIONS.map((section) => (
                <div key={section.key} className="px-4 py-3">
                  <Toggle
                    checked={sections.includes(section.key)}
                    onChange={() => toggleSection(section.key)}
                    label={section.label}
                    description={section.description}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Section 3: Delivery Channel */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-text-secondary">Deliver briefing via</p>
            <div className="flex gap-3">
              {/* Web option (currently the only supported channel) */}
              <div className="flex flex-1 items-center gap-3 rounded-xl border p-4 border-accent-primary/60 bg-accent-glow">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-primary/10">
                  <svg
                    className="h-5 w-5 text-accent-primary"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z"
                    />
                  </svg>
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium text-text-primary">Web</p>
                  <p className="text-xs text-text-muted">In-app dashboard</p>
                </div>
              </div>

              {/* Telegram option (placeholder — disabled until supported) */}
              <button
                type="button"
                disabled
                className={cn(
                  'flex flex-1 items-center gap-3 rounded-xl border p-4 cursor-not-allowed opacity-50',
                  'border-border bg-bg-card',
                )}
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-bg-tertiary">
                  <svg className="h-5 w-5 text-text-muted" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                  </svg>
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium text-text-primary">
                    Telegram
                    <span className="ml-1.5 rounded-full bg-bg-tertiary px-2 py-0.5 text-[10px] font-medium text-text-muted">
                      Soon
                    </span>
                  </p>
                  <p className="text-xs text-text-muted">Direct message via bot</p>
                </div>
              </button>
            </div>
          </div>
        </div>

        {error && <p className="mt-4 text-center text-xs text-error">{error}</p>}

        {/* Navigation */}
        <div className="mt-8 flex items-center justify-between">
          <Button variant="ghost" size="md" onClick={prevStep}>
            <svg className="mr-1 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Back
          </Button>
          <Button variant="primary" size="md" loading={saving} onClick={handleContinue}>
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
