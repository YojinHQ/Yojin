import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface DashboardCardProps {
  /** Card title displayed in the header */
  title: string;
  /** Optional React node rendered to the right of the title (button, link, badge, tabs, etc.) */
  headerAction?: ReactNode;
  /** Card body content — no padding applied, caller controls spacing */
  children: ReactNode;
  /** Additional classes for the outer container */
  className?: string;
  /** 'data' = small uppercase title (default); 'feature' = headline serif title */
  variant?: 'data' | 'feature';
}

const titleStyles = {
  data: 'text-2xs font-medium uppercase tracking-wider text-text-primary',
  feature: 'text-lg font-semibold text-text-primary font-headline',
} as const;

const headerPadding = {
  data: 'px-4 pt-3 pb-2',
  feature: 'px-5 pt-5 pb-3',
} as const;

export function DashboardCard({ title, headerAction, children, className, variant = 'data' }: DashboardCardProps) {
  return (
    <div
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-bg-card',
        className,
      )}
    >
      <div className={cn('flex flex-shrink-0 items-center justify-between', headerPadding[variant])}>
        <h3 className={titleStyles[variant]}>{title}</h3>
        {headerAction}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
