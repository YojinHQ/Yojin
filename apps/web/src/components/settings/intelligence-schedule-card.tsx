import { useState, useEffect, useRef } from 'react';
import { useMutation, useQuery } from 'urql';
import Card from '../common/card';
import Button from '../common/button';
import { BRIEFING_CONFIG_QUERY, SAVE_BRIEFING_CONFIG_MUTATION } from '../../api/documents';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BriefingConfig {
  time: string;
  timezone: string;
  sections: string[];
  enabled: boolean;
  microLlmIntervalHours: number;
}

interface BriefingConfigQueryResult {
  briefingConfig: BriefingConfig | null;
}

const LLM_INTERVAL_OPTIONS = [
  { value: 0.25, label: '15 min' },
  { value: 0.5, label: '30 min' },
  { value: 1, label: '1 hour' },
  { value: 2, label: '2 hours' },
  { value: 4, label: '4 hours' },
  { value: 8, label: '8 hours' },
  { value: 12, label: '12 hours' },
  { value: 24, label: '24 hours' },
];

const DEFAULT_LLM_INTERVAL_HOURS = 4;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function IntelligenceScheduleCard() {
  const [selectedHours, setSelectedHours] = useState(DEFAULT_LLM_INTERVAL_HOURS);
  const [savedHours, setSavedHours] = useState(DEFAULT_LLM_INTERVAL_HOURS);
  const [saving, setSaving] = useState(false);
  const [saved, setSavedState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [{ data, fetching }] = useQuery<BriefingConfigQueryResult>({
    query: BRIEFING_CONFIG_QUERY,
    requestPolicy: 'network-only',
  });
  const [, saveBriefing] = useMutation(SAVE_BRIEFING_CONFIG_MUTATION);

  const config = data?.briefingConfig;

  useEffect(() => {
    if (config) {
      const hours = config.microLlmIntervalHours ?? DEFAULT_LLM_INTERVAL_HOURS;
      setTimeout(() => {
        setSelectedHours(hours);
        setSavedHours(hours);
        setDirty(false);
      }, 0);
    }
  }, [config]);

  function handleSelect(hours: number) {
    setSelectedHours(hours);
    setDirty(hours !== savedHours);
    setError(null);
  }

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    setError(null);

    const result = await saveBriefing({
      input: {
        time: config.time,
        timezone: config.timezone,
        sections: config.sections,
        microLlmIntervalHours: selectedHours,
      },
    });

    setSaving(false);

    if (result.error || !result.data?.saveBriefingConfig) {
      setError('Failed to save. Try again.');
      return;
    }

    setDirty(false);
    setSavedHours(selectedHours);
    setSavedState(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSavedState(false), 2000);
  }

  // Estimated calls/day based on 16 assets, market hours only (~8h), signal-gated
  // Rough heuristic: ~3–5 assets have new signals per cycle on an average day.
  const avgSignaledAssets = 4;
  const cyclesPerDay = Math.max(1, Math.round(8 / selectedHours));
  const estCallsPerDay = avgSignaledAssets * cyclesPerDay;

  return (
    <Card className="overflow-hidden p-0">
      {/* Header */}
      <div className="flex items-center gap-4 px-5 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-primary/10">
          <ClockIcon />
        </div>
        <div>
          <h2 className="font-headline text-lg text-text-primary">Intelligence Schedule</h2>
          <p className="text-sm text-text-muted">Control how often Yojin runs AI analysis on your assets.</p>
        </div>
      </div>

      {/* LLM interval picker */}
      <div className="border-t border-border px-5 py-4 space-y-4">
        <div>
          <p className="text-sm font-medium text-text-primary mb-1">Analysis frequency per asset</p>
          <p className="text-xs text-text-muted mb-3">
            Yojin only runs analysis when new signals arrive. This cap prevents re-analyzing the same asset too often on
            busy news days.
          </p>
          <div className="flex flex-wrap gap-2">
            {LLM_INTERVAL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={selectedHours === opt.value}
                onClick={() => handleSelect(opt.value)}
                className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                  selectedHours === opt.value
                    ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                    : 'border-border bg-bg-secondary text-text-secondary hover:border-accent-primary/50 hover:text-text-primary'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Estimate */}
        <div className="rounded-lg bg-bg-secondary border border-border px-4 py-3 space-y-1.5">
          <p className="text-xs text-text-muted">
            <span className="font-medium text-text-secondary">Estimated LLM calls: </span>~{estCallsPerDay} per day
            <span className="ml-2 text-text-muted/70">
              (signal-gated · ~{avgSignaledAssets} active assets · {cyclesPerDay}×/day)
            </span>
          </p>
          {selectedHours < 1 && (
            <p className="text-xs text-warning">
              Sub-hour intervals increase LLM costs significantly. Only use if you're actively monitoring during market
              hours.
            </p>
          )}
        </div>

        {error && <p className="text-sm text-error">{error}</p>}

        {/* Save button — only shown when briefing is configured and dirty */}
        {config && (
          <div className="flex items-center gap-3">
            <Button variant="primary" size="sm" onClick={handleSave} disabled={saving || !dirty || fetching}>
              {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
            </Button>
            {!dirty && !saving && (
              <p className="text-xs text-text-muted">
                Analysis runs every <span className="font-medium text-text-secondary">{selectedHours}h</span> per asset
                when new signals arrive.
              </p>
            )}
          </div>
        )}

        {!config && !fetching && (
          <p className="text-xs text-text-muted">
            Configure your daily briefing schedule first to enable this setting.
          </p>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function ClockIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-accent-primary"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
