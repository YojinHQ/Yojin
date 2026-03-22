import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { ProgressBar } from './progress-bar';

interface OnboardingShellProps {
  currentStep: number;
  showProgress?: boolean;
  children: ReactNode;
  className?: string;
}

export function OnboardingShell({ currentStep, showProgress = true, children, className }: OnboardingShellProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop overlay */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Modal panel */}
      <div className="relative flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-bg-primary shadow-2xl">
        {/* Atmospheric gradient (decorative) */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
          <div className="absolute -top-1/4 left-1/2 h-[600px] w-[800px] -translate-x-1/2 rounded-full bg-accent-primary/[0.03] blur-[120px]" />
          <div className="absolute -bottom-1/4 right-0 h-[400px] w-[600px] rounded-full bg-accent-primary/[0.02] blur-[100px]" />
        </div>

        {/* Progress bar */}
        {showProgress && (
          <header className="relative z-10 flex shrink-0 justify-center px-6 pt-8 pb-2">
            <ProgressBar currentStep={currentStep} />
          </header>
        )}

        {/* Scrollable content area */}
        <main
          className={cn(
            'relative z-10 flex flex-1 flex-col items-center overflow-y-auto px-8',
            showProgress ? 'pb-10 pt-4' : 'py-10',
            className,
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
