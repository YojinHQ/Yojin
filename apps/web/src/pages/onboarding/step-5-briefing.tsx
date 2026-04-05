import { useState, useCallback, useEffect } from 'react';
import { useMutation } from 'urql';
import { useOnboarding } from '../../lib/onboarding-context';
import { OnboardingShell } from '../../components/onboarding/onboarding-shell';
import { TimePicker } from '../../components/onboarding/time-picker';
import { TimezonePicker } from '../../components/onboarding/timezone-picker';
import Toggle from '../../components/common/toggle';
import Button from '../../components/common/button';
import { cn } from '../../lib/utils';
import { setTimezone as persistTimezone } from '../../lib/timezone';
import { SAVE_BRIEFING_CONFIG_MUTATION } from '../../api/documents';
import { ConnectChannelModal } from '../../components/channels/connect-channel-modal';
import { getChannelMeta } from '../../components/channels/channel-meta';
import { useListChannels } from '../../api/hooks/use-channels';

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

export function Step5Briefing() {
  const { state, updateState, nextStep, prevStep } = useOnboarding();

  const [time, setTime] = useState(state.briefing?.time ?? '08:00');
  const [timezone, setTimezone] = useState(state.briefing?.timezone ?? detectTimezone());
  const [sections, setSections] = useState<string[]>(state.briefing?.sections ?? getDefaultSections());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [, executeSave] = useMutation(SAVE_BRIEFING_CONFIG_MUTATION);
  const [channelsResult, reexecuteChannels] = useListChannels();
  const [connectModalChannel, setConnectModalChannel] = useState<string | null>(null);
  const channels = channelsResult.data?.listChannels ?? [];

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
      const result = await executeSave({ input: { time, timezone, sections } });
      if (result.error) {
        setError(result.error.message || 'Connection failed.');
        return;
      }
      if (result.data?.saveBriefingConfig) {
        updateState({ briefing: { time, timezone, sections } });
        nextStep();
      } else {
        setError('Failed to save config. Try again.');
      }
    } catch {
      setError('Connection failed.');
    } finally {
      setSaving(false);
    }
  }, [time, timezone, sections, updateState, nextStep, executeSave]);

  return (
    <OnboardingShell currentStep={5}>
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

          {/* Section 3: Notification Channels */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-text-secondary">Connect channels for notifications</p>
            <div className="grid grid-cols-2 gap-3">
              {channels.map((ch) => {
                const meta = getChannelMeta(ch.id);
                const connected = ch.status === 'CONNECTED';

                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => {
                      if (!connected && ch.id !== 'web') {
                        setConnectModalChannel(ch.id);
                      }
                    }}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border p-4 transition-all duration-200',
                      connected
                        ? 'border-success/40 bg-success/5'
                        : 'border-border bg-bg-card hover:border-accent-primary/30 cursor-pointer',
                    )}
                  >
                    <div
                      className={cn(
                        'flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold',
                        !meta.logo && meta.color,
                      )}
                    >
                      {meta.logo ? (
                        <img src={meta.logo} alt={meta.label} className="h-8 object-contain" />
                      ) : (
                        meta.initials
                      )}
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium text-text-primary">
                        {meta.label}
                        {connected ? (
                          <span className="ml-1.5 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
                            Connected
                          </span>
                        ) : (
                          ch.id !== 'web' && (
                            <span className="ml-1.5 rounded-full bg-bg-tertiary px-2 py-0.5 text-[10px] font-medium text-text-muted">
                              Connect
                            </span>
                          )
                        )}
                      </p>
                      <p className="text-xs text-text-muted">{meta.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <ConnectChannelModal
            open={connectModalChannel !== null}
            channelId={connectModalChannel}
            onClose={() => setConnectModalChannel(null)}
            onConnected={() => {
              setConnectModalChannel(null);
              reexecuteChannels({ requestPolicy: 'network-only' });
            }}
          />
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
