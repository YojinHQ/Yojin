import { cn } from '../../lib/utils';

interface CardProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
  /** Section variant: larger padding, spaced children, uppercase title */
  section?: boolean;
}

export default function Card({ title, children, className = '', section = false }: CardProps) {
  return (
    <div className={cn('rounded-xl border border-border bg-bg-card', section ? 'p-5 space-y-4' : 'p-4', className)}>
      {title && (
        <h3 className={cn('text-xs font-medium text-text-secondary', section ? 'uppercase tracking-wider' : 'mb-3')}>
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}
