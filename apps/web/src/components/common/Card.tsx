import { cn } from '../../lib/utils';

interface CardProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export default function Card({ title, children, className = '' }: CardProps) {
  return (
    <div className={cn('rounded-xl border border-border bg-bg-card p-5', className)}>
      {title && <h3 className="mb-4 text-sm font-medium text-text-secondary">{title}</h3>}
      {children}
    </div>
  );
}
