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
    <div className="relative flex min-h-screen flex-col bg-bg-primary">
      {/* Atmospheric gradient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-1/4 left-1/2 h-[600px] w-[800px] -translate-x-1/2 rounded-full bg-accent-primary/[0.03] blur-[120px]" />
        <div className="absolute -bottom-1/4 right-0 h-[400px] w-[600px] rounded-full bg-accent-primary/[0.02] blur-[100px]" />
      </div>

      {/* Progress bar */}
      {showProgress && (
        <header className="relative z-10 flex justify-center px-6 pt-8 pb-2">
          <ProgressBar currentStep={currentStep} />
        </header>
      )}

      {/* Content area */}
      <main
        className={cn(
          'relative z-10 flex flex-1 flex-col items-center justify-center px-6',
          showProgress ? 'pb-12 pt-4' : 'py-12',
          className,
        )}
      >
        {children}
      </main>
    </div>
  );
}
