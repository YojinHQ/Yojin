import { useState, useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery } from 'urql';
import Card from '../common/card';
import Button from '../common/button';
import Toggle from '../common/toggle';
import { GateCard } from '../common/feature-gate';
import { TimePicker } from '../onboarding/time-picker';
import { TimezonePicker } from '../onboarding/timezone-picker';
import { BRIEFING_CONFIG_QUERY, ONBOARDING_STATUS_QUERY, SAVE_BRIEFING_CONFIG_MUTATION } from '../../api/documents';
import type { OnboardingStatusQueryResult } from '../../api/types';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

interface BriefingConfig {
  time: string;
  timezone: string;
  sections: string[];
  enabled: boolean;
  microLlmIntervalHours: number;
}

interface DigestSection {
  key: string;
  label: string;
  description: string;
}

const DIGEST_SECTIONS: DigestSection[] = [
  { key: 'portfolio-performance', label: 'Portfolio performance', description: 'Change since yesterday' },
  { key: 'top-movers', label: 'Top movers', description: 'Biggest gainers and losers' },
  { key: 'earnings-calendar', label: 'Earnings calendar', description: 'Upcoming earnings' },
  { key: 'analyst-ratings', label: 'Analyst rating changes', description: 'Upgrades and downgrades' },
  { key: 'insider-activity', label: 'Insider activity', description: 'Insider buys and sells' },
  { key: 'market-sentiment', label: 'Market sentiment', description: 'Overall mood and VIX' },
  { key: 'macro-events', label: 'Macro events', description: 'Fed, CPI, etc.' },
];

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'America/New_York';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DailyInsightsCard() {
  const [{ data: statusData }] = useQuery<OnboardingStatusQueryResult>({
    query: ONBOARDING_STATUS_QUERY,
  });
  const jintelConfigured = statusData?.onboardingStatus?.jintelConfigured ?? false;

  return (
    <div className="relative">
      <Card className="overflow-hidden p-0">
        {/* Header */}
        <div className="flex items-center gap-4 px-5 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-primary/10">
            <CalendarIcon />
          </div>
          <div>
            <h2 className="font-headline text-lg text-text-primary">Daily Insights</h2>
            <p className="text-sm text-text-muted">Configure your daily briefing schedule and content.</p>
          </div>
        </div>

        {/* Content */}
        <div className="border-t border-border px-5 py-4">
          <BriefingEditor />
        </div>
      </Card>

      {!jintelConfigured && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-bg-primary/70 backdrop-blur-[3px]">
          <GateCard
            requires="jintel"
            subtitle="Jintel is free to use. Connect it to unlock live market data and analytics."
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BriefingEditor (internal)
// ---------------------------------------------------------------------------

function BriefingEditor() {
  const [result] = useQuery<{ briefingConfig: BriefingConfig | null }>({ query: BRIEFING_CONFIG_QUERY });
  const [, saveBriefing] = useMutation(SAVE_BRIEFING_CONFIG_MUTATION);

  const config = result.data?.briefingConfig;
  const loading = result.fetching;

  const [time, setTime] = useState('08:00');
  const [timezone, setTimezone] = useState(detectTimezone);
  const [sections, setSections] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const hydrateTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (config) {
      const nextTime = config.time;
      const nextTimezone = config.timezone;
      const nextSections = config.sections;
      if (hydrateTimeoutRef.current) clearTimeout(hydrateTimeoutRef.current);
      hydrateTimeoutRef.current = setTimeout(() => {
        setTime(nextTime);
        setTimezone(nextTimezone);
        setSections(nextSections);
        setDirty(false);
      }, 0);
    }
    return () => {
      if (hydrateTimeoutRef.current) clearTimeout(hydrateTimeoutRef.current);
    };
  }, [config]);

  const markDirty = () => {
    setDirty(true);
    setSaved(false);
    setSaveError(null);
  };
  const handleTimeChange = (t: string) => {
    setTime(t);
    markDirty();
  };
  const handleTimezoneChange = (tz: string) => {
    setTimezone(tz);
    markDirty();
  };
  const toggleSection = (key: string) => {
    setSections((prev) => (prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]));
    markDirty();
  };

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const result = await saveBriefing({ input: { time, timezone, sections } });
      if (result.error) {
        setSaveError(result.error.message || 'Failed to save schedule');
        return;
      }
      setSaved(true);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }, [saveBriefing, time, timezone, sections]);

  if (loading) {
    return <p className="text-sm text-text-muted">Loading schedule...</p>;
  }

  if (!config) {
    return (
      <p className="text-sm text-text-muted">
        No briefing configured yet. Complete onboarding to set up your daily insights schedule.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {/* Schedule */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-text-secondary">Run daily at</p>
        <div className="flex items-center gap-4">
          <TimePicker value={time} onChange={handleTimeChange} />
          <TimezonePicker value={timezone} onChange={handleTimezoneChange} />
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-text-secondary">Include in briefing</p>
        <div className="divide-y divide-border rounded-xl border border-border bg-bg-card">
          {DIGEST_SECTIONS.map((section) => (
            <div key={section.key} className="px-4 py-2.5">
              <Toggle
                size="sm"
                checked={sections.includes(section.key)}
                onChange={() => toggleSection(section.key)}
                label={section.label}
                description={section.description}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button variant="primary" size="sm" loading={saving} disabled={!dirty} onClick={handleSave}>
          Save schedule
        </Button>
        {saved && <span className="text-xs text-success">Saved</span>}
        {saveError && <span className="text-xs text-error">{saveError}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icon
// ---------------------------------------------------------------------------

function CalendarIcon() {
  return (
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
        d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5m-9-6h.008v.008H12v-.008ZM12 15h.008v.008H12V15Zm0 2.25h.008v.008H12v-.008ZM9.75 15h.008v.008H9.75V15Zm0 2.25h.008v.008H9.75v-.008ZM7.5 15h.008v.008H7.5V15Zm0 2.25h.008v.008H7.5v-.008Zm6.75-4.5h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V15Zm0 2.25h.008v.008h-.008v-.008Zm2.25-4.5h.008v.008H16.5v-.008Zm0 2.25h.008v.008H16.5V15Z"
      />
    </svg>
  );
}
