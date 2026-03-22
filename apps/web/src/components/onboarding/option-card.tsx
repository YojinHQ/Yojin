import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import Badge from '../common/badge';

interface OptionCardProps {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
  badge?: string;
  icon?: ReactNode;
  children?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function OptionCard({
  selected,
  onSelect,
  title,
  description,
  badge,
  icon,
  children,
  disabled = false,
  className,
}: OptionCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        'group w-full rounded-xl border p-5 text-left transition-all duration-200',
        selected
          ? 'border-accent-primary/60 bg-accent-glow'
          : 'border-border bg-bg-card hover:border-border-light hover:bg-bg-hover/50',
        disabled && 'cursor-not-allowed opacity-40',
        className,
      )}
    >
      <div className="flex items-start gap-3.5">
        {/* Radio indicator */}
        <div
          className={cn(
            'mt-0.5 flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors',
            selected ? 'border-accent-primary' : 'border-border-light group-hover:border-text-muted',
          )}
        >
          {selected && <div className="h-2 w-2 rounded-full bg-accent-primary" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {icon && <span className="text-text-secondary">{icon}</span>}
            <span className={cn('text-sm font-medium', selected ? 'text-text-primary' : 'text-text-secondary')}>
              {title}
            </span>
            {badge && (
              <Badge variant="accent" size="xs">
                {badge}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">{description}</p>
          {children && <div className="mt-3">{children}</div>}
        </div>
      </div>
    </button>
  );
}
