import { useState } from 'react';
import { isOnboardingSkipped, useOnboardingModal } from '../../lib/onboarding-context';
import { cn } from '../../lib/utils';
import Button from '../common/button';

export function SetupBanner() {
  const { openOnboarding } = useOnboardingModal();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !isOnboardingSkipped()) return null;

  return (
    <div
      className={cn(
        'flex items-center justify-between rounded-xl border border-accent-primary/20 bg-accent-glow px-4 py-3',
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-primary/10">
          <svg
            className="h-4 w-4 text-accent-primary"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z"
            />
          </svg>
        </div>
        <p className="text-sm text-text-primary">Finish setting up Yojin to unlock all features</p>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={openOnboarding}>
          Continue setup
        </Button>
        <button
          onClick={() => setDismissed(true)}
          className="cursor-pointer flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-hover hover:text-text-secondary"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
