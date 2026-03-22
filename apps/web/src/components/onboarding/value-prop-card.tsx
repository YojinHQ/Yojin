import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface ValuePropCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  delay?: number;
  className?: string;
}

export function ValuePropCard({ icon, title, description, delay = 0, className }: ValuePropCardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-bg-card/80 p-6 text-center backdrop-blur-sm',
        'opacity-0 [animation:onboarding-fade-up_0.5s_ease-out_forwards]',
        className,
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="mb-4 flex justify-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-glow text-accent-primary">
          {icon}
        </div>
      </div>
      <h3 className="mb-2 font-headline text-lg text-text-primary">{title}</h3>
      <p className="text-sm leading-relaxed text-text-secondary">{description}</p>
    </div>
  );
}
