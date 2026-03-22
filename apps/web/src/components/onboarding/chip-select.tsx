import { cn } from '../../lib/utils';

interface ChipSelectProps {
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  label?: string;
  className?: string;
}

export function ChipSelect({ options, selected, onChange, label, className }: ChipSelectProps) {
  const toggle = (option: string) => {
    if (selected.includes(option)) {
      onChange(selected.filter((s) => s !== option));
    } else {
      onChange([...selected, option]);
    }
  };

  return (
    <div className={cn('space-y-2', className)}>
      {label && <p className="text-sm font-medium text-text-secondary">{label}</p>}
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isSelected = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              onClick={() => toggle(option)}
              className={cn(
                'cursor-pointer rounded-lg border px-4 py-2 text-sm font-medium transition-all duration-200',
                isSelected
                  ? 'border-accent-primary/60 bg-accent-glow text-text-primary'
                  : 'border-border bg-bg-card text-text-secondary hover:border-accent-primary/30 hover:bg-bg-hover/60 hover:text-text-primary',
              )}
            >
              {isSelected && (
                <svg
                  className="mr-1.5 -ml-0.5 inline h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2.5}
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              )}
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}
