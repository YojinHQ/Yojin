import type { ReactNode } from 'react';

interface CardBlurGateProps {
  mockContent: ReactNode;
  /** Optional gate CTA wrapped in a frosted card. Omit to show the blurred preview alone. */
  children?: ReactNode;
}

export function CardBlurGate({ mockContent, children }: CardBlurGateProps) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="pointer-events-none select-none" aria-hidden="true">
        {mockContent}
      </div>
      <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg-card/80 backdrop-blur-[3px]">
        {children && (
          <div className="mx-4 max-w-xs rounded-xl border border-border bg-bg-card px-6 py-5 shadow-lg">{children}</div>
        )}
      </div>
    </div>
  );
}
