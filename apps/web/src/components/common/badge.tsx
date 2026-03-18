import { cn } from '../../lib/utils';

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'accent' | 'market';
type BadgeSize = 'xs' | 'sm' | 'md';

interface BadgeProps {
  variant: BadgeVariant;
  children: React.ReactNode;
  size?: BadgeSize;
  outline?: boolean;
  className?: string;
}

const fillStyles: Record<BadgeVariant, string> = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  error: 'bg-error/10 text-error',
  info: 'bg-info/10 text-info',
  neutral: 'bg-bg-tertiary text-text-muted',
  accent: 'bg-accent-primary/10 text-accent-primary',
  market: 'bg-market/10 text-market',
};

const outlineStyles: Record<BadgeVariant, string> = {
  success: 'border border-success text-success',
  warning: 'border border-warning text-warning',
  error: 'border border-error text-error',
  info: 'border border-info text-info',
  neutral: 'border border-text-muted text-text-muted',
  accent: 'border border-accent-primary text-accent-primary',
  market: 'border border-market text-market',
};

const sizeStyles: Record<BadgeSize, string> = {
  xs: 'px-1.5 py-px text-3xs',
  sm: 'px-1.5 py-px text-2xs',
  md: 'px-2 py-px text-xs ring-1 ring-inset ring-current/20',
};

export type { BadgeVariant, BadgeSize };

export default function Badge({ variant, children, size = 'sm', outline = false, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium',
        sizeStyles[size],
        outline ? outlineStyles[variant] : fillStyles[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
