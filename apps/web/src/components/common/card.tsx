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
    <div className={cn('rounded-xl border border-border bg-bg-card', section ? 'p-6 space-y-5' : 'p-5', className)}>
      {title && (
        <h3 className={cn('text-sm font-medium text-text-secondary', section ? 'uppercase tracking-wider' : 'mb-4')}>
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}
