import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface Option {
  id: string;
  icon?: ReactNode;
  label: string;
  description?: string;
}

export interface OptionSelectorProps {
  title: string;
  subtitle?: string;
  options: Option[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onBack?: () => void;
  layout?: 'grid' | 'stack';
}

export default function OptionSelector({
  title,
  subtitle,
  options,
  selectedId,
  onSelect,
  onBack,
  layout = 'grid',
}: OptionSelectorProps) {
  return (
    <div>
      {/* Header with optional back button */}
      <div className="mb-5 flex items-center gap-3">
        {onBack && (
          <button
            onClick={onBack}
            className="flex h-10 w-10 flex-shrink-0 cursor-pointer items-center justify-center rounded-full bg-bg-tertiary text-text-secondary transition-colors hover:bg-bg-hover"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <div>
          <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
          {subtitle && <p className="mt-0.5 text-sm text-text-muted">{subtitle}</p>}
        </div>
      </div>

      {/* Options */}
      <div className={cn(layout === 'grid' ? 'grid grid-cols-2 gap-3' : 'flex flex-col gap-3')}>
        {options.map((opt) => {
          const isSelected = opt.id === selectedId;
          return (
            <button
              key={opt.id}
              onClick={() => onSelect(opt.id)}
              className={cn(
                'relative cursor-pointer overflow-hidden rounded-xl border text-left transition-all',
                opt.description ? 'px-5 py-4' : 'px-5 py-4',
                isSelected
                  ? 'border-accent-primary bg-gradient-to-r from-accent-primary/20 via-accent-primary/8 to-transparent'
                  : 'border-border-light bg-bg-secondary hover:border-text-muted hover:bg-bg-hover',
              )}
            >
              <div className="flex items-center gap-3.5">
                {opt.icon !== undefined && (
                  <div
                    className={cn(
                      'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl transition-colors',
                      isSelected ? 'bg-accent-primary text-white' : 'bg-bg-tertiary text-text-muted',
                    )}
                  >
                    {opt.icon ?? (
                      <div className={cn('h-2.5 w-2.5 rounded-full', isSelected ? 'bg-white' : 'bg-text-muted')} />
                    )}
                  </div>
                )}
                <div>
                  <div className="text-sm font-medium text-text-primary">{opt.label}</div>
                  {opt.description && <div className="mt-0.5 text-xs text-text-muted">{opt.description}</div>}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
