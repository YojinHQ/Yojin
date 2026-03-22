import { cn } from '../../lib/utils';

interface SummaryRowProps {
  completed: boolean;
  label: string;
  detail: string;
  className?: string;
}

export function SummaryRow({ completed, label, detail, className }: SummaryRowProps) {
  return (
    <div className={cn('flex items-center gap-3 py-3', className)}>
      {/* Status icon */}
      {completed ? (
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-success/10">
          <svg
            className="h-3.5 w-3.5 text-success"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2.5}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        </div>
      ) : (
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-bg-tertiary">
          <div className="h-1.5 w-1.5 rounded-full bg-text-muted" />
        </div>
      )}

      {/* Label */}
      <span className={cn('text-sm font-medium', completed ? 'text-text-primary' : 'text-text-muted')}>{label}</span>

      {/* Spacer + Detail */}
      <span className={cn('ml-auto text-sm', completed ? 'text-text-secondary' : 'text-text-muted')}>{detail}</span>
    </div>
  );
}
