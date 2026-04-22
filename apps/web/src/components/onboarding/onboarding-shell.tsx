import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useOnboarding } from '../../lib/onboarding-context';
import { ProgressBar } from './progress-bar';

interface OnboardingShellProps {
  currentStep: number;
  showProgress?: boolean;
  children: ReactNode;
  className?: string;
}

export function OnboardingShell({ currentStep, showProgress = true, children, className }: OnboardingShellProps) {
  const { skipOnboarding } = useOnboarding();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.repeat) return;
      skipOnboarding();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [skipOnboarding]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop overlay */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Modal panel */}
      <div className="relative flex h-[70vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-bg-primary shadow-2xl">
        {/* Atmospheric gradient (decorative) */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
          <div className="absolute -top-1/4 left-1/2 h-[600px] w-[800px] -translate-x-1/2 rounded-full bg-accent-primary/[0.03] blur-[120px]" />
          <div className="absolute -bottom-1/4 right-0 h-[400px] w-[600px] rounded-full bg-accent-primary/[0.02] blur-[100px]" />
        </div>

        {/* Close button */}
        <button
          type="button"
          onClick={skipOnboarding}
          aria-label="Close"
          className="absolute right-4 top-4 z-20 flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Progress bar */}
        {showProgress && (
          <header className="relative z-10 flex shrink-0 justify-center px-6 pt-8 pb-2">
            <ProgressBar currentStep={currentStep} />
          </header>
        )}

        {/* Scrollable content area */}
        <main
          className={cn(
            'relative z-10 flex flex-1 flex-col overflow-y-auto px-8',
            showProgress ? 'pb-10 pt-4' : 'py-10',
            className,
          )}
        >
          {/* Inner wrapper — keeps content centered when it fits, scrolls from the top
              when it overflows (otherwise `justify-center` on the scroller clips the
              top half out of reach). */}
          <div className="m-auto flex w-full flex-col items-center">{children}</div>
        </main>
      </div>
    </div>
  );
}
