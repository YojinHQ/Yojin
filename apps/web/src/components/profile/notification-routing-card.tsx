import { useState } from 'react';
import { useQuery } from 'urql';
import Card from '../common/card';
import Toggle from '../common/toggle';
import { GateCard } from '../common/feature-gate';
import {
  useListChannels,
  useNotificationPreferences,
  useSaveNotificationPreferences,
} from '../../api/hooks/use-channels';
import { ONBOARDING_STATUS_QUERY } from '../../api/documents';
import type { OnboardingStatusQueryResult } from '../../api/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NOTIFICATION_TYPES = [
  { key: 'snap.ready', label: 'Snap briefs', description: 'Periodic attention summaries' },
  { key: 'insight.ready', label: 'Daily insights', description: 'Full portfolio analysis reports' },
  { key: 'action.created', label: 'Action alerts', description: 'Skill-triggered trade recommendations' },
  { key: 'approval.requested', label: 'Approval requests', description: 'Actions requiring your approval' },
];

/** Types enabled by default when user has no explicit preferences (matches backend DEFAULT_ENABLED_TYPES). */
const DEFAULT_ENABLED_TYPES = ['insight.ready', 'action.created', 'approval.requested'];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NotificationRoutingCard() {
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
            <RouteIcon />
          </div>
          <div>
            <h2 className="font-headline text-lg text-text-primary">Notification Routing</h2>
            <p className="text-sm text-text-muted">Choose which notifications each channel receives.</p>
          </div>
        </div>

        {/* Content */}
        <div className="border-t border-border px-5 py-4">
          <NotificationPreferencesEditor />
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
// NotificationPreferencesEditor (internal)
// ---------------------------------------------------------------------------

function NotificationPreferencesEditor() {
  const [channelsResult] = useListChannels();
  const [prefsResult] = useNotificationPreferences();
  const [, savePrefs] = useSaveNotificationPreferences();

  const channels = (channelsResult.data?.listChannels ?? []).filter((ch) => ch.status === 'CONNECTED');
  const prefs = prefsResult.data?.notificationPreferences ?? [];

  const isEnabled = (channelId: string, notificationType: string): boolean => {
    const channelPrefs = prefs.find((p) => p.channelId === channelId);
    if (!channelPrefs) return DEFAULT_ENABLED_TYPES.includes(notificationType);
    return channelPrefs.enabledTypes.includes(notificationType);
  };

  const [saveError, setSaveError] = useState<string | null>(null);

  const handleToggle = async (channelId: string, notificationType: string) => {
    const channelPrefs = prefs.find((p) => p.channelId === channelId);
    const currentTypes = channelPrefs?.enabledTypes ?? DEFAULT_ENABLED_TYPES;

    const newTypes = currentTypes.includes(notificationType)
      ? currentTypes.filter((t) => t !== notificationType)
      : [...currentTypes, notificationType];

    setSaveError(null);
    const res = await savePrefs({ channelId, enabledTypes: newTypes });
    if (res.error) {
      setSaveError(res.error.message || 'Failed to save');
    }
  };

  if (channelsResult.fetching || prefsResult.fetching) {
    return <p className="text-sm text-text-muted">Loading...</p>;
  }

  if (channelsResult.error || prefsResult.error) {
    return <p className="text-sm text-error">Failed to load notification preferences.</p>;
  }

  if (channels.length === 0) {
    return <p className="text-sm text-text-muted">No channels connected.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 pr-4 text-xs font-medium uppercase tracking-wider text-text-muted">
                Notification
              </th>
              {channels.map((ch) => (
                <th
                  key={ch.id}
                  className="text-center py-2 px-3 text-xs font-medium uppercase tracking-wider text-text-muted"
                >
                  {ch.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_TYPES.map((nt) => (
              <tr key={nt.key} className="border-b border-border last:border-0">
                <td className="py-3 pr-4">
                  <p className="text-sm text-text-primary">{nt.label}</p>
                  <p className="text-xs text-text-muted">{nt.description}</p>
                </td>
                {channels.map((ch) => (
                  <td key={ch.id} className="text-center py-3 px-3">
                    <Toggle size="sm" checked={isEnabled(ch.id, nt.key)} onChange={() => handleToggle(ch.id, nt.key)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {saveError && <p className="text-sm text-error">{saveError}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icon
// ---------------------------------------------------------------------------

function RouteIcon() {
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
        d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
      />
    </svg>
  );
}
