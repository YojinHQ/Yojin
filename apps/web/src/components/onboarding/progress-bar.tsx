import { cn } from '../../lib/utils';

interface ProgressBarProps {
  currentStep: number;
  totalSteps?: number;
}

const STEP_LABELS = ['AI Brain', 'Persona', 'Jintel', 'Platforms', 'Briefing', 'Done'];

export function ProgressBar({ currentStep, totalSteps = 6 }: ProgressBarProps) {
  return (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length: totalSteps }, (_, i) => {
        const stepNum = i + 1;
        const isCompleted = currentStep > stepNum;
        const isActive = currentStep === stepNum;
        const isUpcoming = currentStep < stepNum;

        return (
          <div key={i} className="flex items-center gap-2">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={cn(
                  'flex h-2.5 w-2.5 items-center justify-center rounded-full transition-all duration-500',
                  isCompleted && 'bg-accent-primary',
                  isActive && 'bg-accent-primary shadow-[0_0_0_4px_rgba(255,90,94,0.15)]',
                  isUpcoming && 'bg-bg-tertiary',
                )}
              />
              <span
                className={cn(
                  'text-3xs font-medium transition-colors duration-300 hidden sm:block',
                  isCompleted && 'text-text-secondary',
                  isActive && 'text-accent-primary',
                  isUpcoming && 'text-text-muted',
                )}
              >
                {STEP_LABELS[i]}
              </span>
            </div>
            {i < totalSteps - 1 && (
              <div
                className={cn(
                  'h-px w-8 sm:w-12 transition-colors duration-500 -mt-4 sm:-mt-[18px]',
                  currentStep > stepNum + 1
                    ? 'bg-accent-primary'
                    : currentStep > stepNum
                      ? 'bg-accent-primary/40'
                      : 'bg-bg-tertiary',
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
