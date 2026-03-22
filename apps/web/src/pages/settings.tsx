import { useState, useCallback } from 'react';
import { useMutation } from 'urql';
import { useTheme } from '../lib/theme';
import type { ThemeChoice } from '../lib/theme';
import { cn } from '../lib/utils';
import Card from '../components/common/card';
import Button from '../components/common/button';
import Toggle from '../components/common/toggle';
import { RESET_ONBOARDING_MUTATION } from '../api/documents';
import { useOnboardingStatus } from '../lib/onboarding-context';

export default function Settings() {
  const { theme, setTheme } = useTheme();
  const [notifications, setNotifications] = useState({
    morningDigest: true,
    priceAlerts: true,
    riskWarnings: true,
    agentActivity: false,
  });
  const [privacy, setPrivacy] = useState({
    piiRedaction: true,
    auditLogging: true,
  });

  const updateNotification = (key: keyof typeof notifications) => (value: boolean) => {
    setNotifications((prev) => ({ ...prev, [key]: value }));
  };

  const updatePrivacy = (key: keyof typeof privacy) => (value: boolean) => {
    setPrivacy((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      <Card title="Appearance" section>
        <ThemePicker current={theme} onChange={setTheme} />
      </Card>

      <Card title="Notifications" section>
        <div className="space-y-4">
          <Toggle
            label="Morning digest"
            description="Daily portfolio summary at 8 AM"
            checked={notifications.morningDigest}
            onChange={updateNotification('morningDigest')}
          />
          <Toggle
            label="Price alerts"
            description="Notify when positions hit target price"
            checked={notifications.priceAlerts}
            onChange={updateNotification('priceAlerts')}
          />
          <Toggle
            label="Risk warnings"
            description="Alert on concentration or exposure changes"
            checked={notifications.riskWarnings}
            onChange={updateNotification('riskWarnings')}
          />
          <Toggle
            label="Agent activity"
            description="Notify when agents complete tasks"
            checked={notifications.agentActivity}
            onChange={updateNotification('agentActivity')}
          />
        </div>
      </Card>

      <Card title="Data & Privacy" section>
        <div className="space-y-4">
          <Toggle
            label="PII redaction"
            description="Strip personal identifiers before external API calls"
            checked={privacy.piiRedaction}
            onChange={updatePrivacy('piiRedaction')}
          />
          <Toggle
            label="Audit logging"
            description="Log all security events to audit trail"
            checked={privacy.auditLogging}
            onChange={updatePrivacy('auditLogging')}
          />
        </div>
      </Card>

      {import.meta.env.DEV && <DevTools />}
    </div>
  );
}

function DevTools() {
  const { openOnboarding, resetOnboardingStatus } = useOnboardingStatus();
  const [, resetOnboarding] = useMutation(RESET_ONBOARDING_MUTATION);
  const [resetting, setResetting] = useState(false);

  const handleResetOnboarding = useCallback(async () => {
    setResetting(true);
    try {
      await resetOnboarding({});
      resetOnboardingStatus();
      openOnboarding();
    } finally {
      setResetting(false);
    }
  }, [resetOnboarding, resetOnboardingStatus, openOnboarding]);

  return (
    <Card title="Developer" section>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-text-primary">Reset onboarding</p>
            <p className="text-xs text-text-muted">Clear server-side state and restart the onboarding flow</p>
          </div>
          <Button variant="danger" size="sm" loading={resetting} onClick={handleResetOnboarding}>
            Reset
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ThemePicker({ current, onChange }: { current: ThemeChoice; onChange: (t: ThemeChoice) => void }) {
  const options: { value: ThemeChoice; label: string; icon: React.ReactNode }[] = [
    {
      value: 'light',
      label: 'Light',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
          />
        </svg>
      ),
    },
    {
      value: 'system',
      label: 'System',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25A2.25 2.25 0 0 1 5.25 3h13.5A2.25 2.25 0 0 1 21 5.25Z"
          />
        </svg>
      ),
    },
    {
      value: 'dark',
      label: 'Dark',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z"
          />
        </svg>
      ),
    },
  ];

  return (
    <div className="flex gap-3">
      {options.map((opt) => {
        const active = current === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              'flex flex-col items-center gap-2 rounded-xl border px-6 py-4 transition-colors',
              active
                ? 'border-accent-primary bg-accent-glow text-accent-primary'
                : 'border-border bg-bg-secondary text-text-muted hover:border-border-light hover:text-text-secondary',
            )}
          >
            {opt.icon}
            <span className="text-xs font-medium">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
