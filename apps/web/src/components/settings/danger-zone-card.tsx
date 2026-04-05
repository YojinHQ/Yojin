import { useCallback, useState } from 'react';
import { useMutation } from 'urql';
import Card from '../common/card';
import Button from '../common/button';
import { RESET_ONBOARDING_MUTATION } from '../../api/documents';
import { useClearAppData } from '../../api/hooks';
import { useOnboardingStatus } from '../../lib/onboarding-context';

export function DangerZoneCard() {
  const [clearing, setClearing] = useState(false);
  const [resetting, setResetting] = useState(false);

  const [, clearAppData] = useClearAppData();
  const [, resetOnboarding] = useMutation(RESET_ONBOARDING_MUTATION);
  const { openOnboarding, resetOnboardingStatus } = useOnboardingStatus();

  const handleResetOnboarding = useCallback(async () => {
    setResetting(true);
    try {
      const result = await resetOnboarding({});
      if (result.error) {
        console.error('Reset onboarding failed:', result.error.message);
      }
      resetOnboardingStatus();
      openOnboarding();
    } finally {
      setResetting(false);
    }
  }, [resetOnboarding, resetOnboardingStatus, openOnboarding]);

  return (
    <Card className="border-error/20 overflow-hidden p-0">
      <div className="flex items-center gap-4 px-5 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-error/10">
          <AlertIcon />
        </div>
        <div>
          <h2 className="font-headline text-lg text-text-primary">Danger Zone</h2>
          <p className="text-sm text-text-muted">Irreversible actions that reset or clear your data.</p>
        </div>
      </div>
      <div className="border-t border-error/10">
        <DangerRow
          title="Reset onboarding"
          description="Clear server-side state and restart the onboarding flow"
          actionLabel="Reset"
          confirmLabel="Confirm"
          requireConfirm
          loading={resetting}
          onAction={handleResetOnboarding}
        />
        <div className="border-t border-error/10" />
        <DangerRow
          title="Clear app data"
          description="Removes portfolio, insights, sessions, and brain memory. Vault, config, and device identity are preserved."
          actionLabel="Clear"
          loading={clearing}
          confirmLabel="Confirm"
          requireConfirm
          onAction={async () => {
            setClearing(true);
            try {
              const result = await clearAppData({});
              if (result.error || result.data?.clearAppData === false) {
                setClearing(false);
                return;
              }
              window.location.href = '/';
            } catch {
              setClearing(false);
            }
          }}
        />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// DangerRow
// ---------------------------------------------------------------------------

function DangerRow({
  title,
  description,
  actionLabel,
  confirmLabel,
  loading,
  requireConfirm,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel: string;
  confirmLabel?: string;
  loading: boolean;
  requireConfirm?: boolean;
  onAction: () => void | Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex items-center justify-between px-5 py-4">
      <div className="min-w-0 mr-4">
        <p className="text-sm font-medium text-text-primary">{title}</p>
        <p className="text-xs text-text-muted mt-0.5">{description}</p>
      </div>
      <div className="shrink-0">
        {requireConfirm && confirming ? (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="danger"
              loading={loading}
              onClick={async () => {
                await onAction();
                setConfirming(false);
              }}
            >
              {confirmLabel ?? 'Confirm'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="danger"
            loading={loading}
            onClick={() => {
              if (requireConfirm) {
                setConfirming(true);
              } else {
                onAction();
              }
            }}
          >
            {actionLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icon
// ---------------------------------------------------------------------------

function AlertIcon() {
  return (
    <svg className="h-5 w-5 text-error" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
      />
    </svg>
  );
}
