import type { ReactNode } from 'react';

interface CardBlurGateProps {
  /** Static mock content shown behind the blur */
  mockContent: ReactNode;
  /** Gate message shown centered over the blur — wrapped in a frosted card */
  children: ReactNode;
}

/**
 * Overlays a frosted glass gate on top of mock/placeholder content.
 * Children are wrapped in a card container so they don't blend with the blur.
 */
export function CardBlurGate({ mockContent, children }: CardBlurGateProps) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="pointer-events-none select-none" aria-hidden="true">
        {mockContent}
      </div>
      <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg-card/80 backdrop-blur-[3px]">
        <div className="mx-4 max-w-xs rounded-xl border border-border bg-bg-card px-6 py-5 shadow-lg">{children}</div>
      </div>
    </div>
  );
}
