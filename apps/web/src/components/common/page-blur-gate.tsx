import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useFeatureStatus } from '../../lib/feature-status';
import { GATES, GateLogo, getMissing, type GateRequirement } from '../../lib/gate-config';
import Button from './button';

interface PageBlurGateProps {
  requires: GateRequirement;
  mockContent: ReactNode;
  children: ReactNode;
}

/**
 * Page-level feature gate with blurred mock content preview.
 * Shows mock page content behind a frosted glass overlay with a branded gate card.
 * Use this instead of `PageFeatureGate` when you have mock content to preview.
 */
export function PageBlurGate({ requires, mockContent, children }: PageBlurGateProps) {
  const { jintelConfigured, aiConfigured, loading } = useFeatureStatus();

  if (loading) return null;

  const missing = getMissing(requires, jintelConfigured, aiConfigured);
  if (missing.length === 0) return <>{children}</>;

  const primary = GATES[missing[0]];
  const secondary = missing.length > 1 ? GATES[missing[1]] : null;

  return (
    <div className="relative flex flex-1 overflow-hidden">
      {/* Mock content behind blur — decorative only */}
      <div className="pointer-events-none flex flex-1 select-none" aria-hidden="true">
        {mockContent}
      </div>

      {/* Frosted overlay with branded gate card */}
      <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg-primary/70 backdrop-blur-[4px]">
        <div className="flex max-w-sm flex-col items-center gap-4 rounded-2xl border border-border bg-bg-card px-8 py-8 text-center shadow-xl">
          <GateLogo requires={missing[0]} />
          <div>
            <h2 className="text-base font-medium text-text-primary">{primary.title}</h2>
            <p className="mt-1.5 max-w-[280px] text-sm text-text-muted">{primary.subtitle}</p>
          </div>

          <Link to={primary.href}>
            <Button variant="primary" size="sm">
              {primary.cta}
            </Button>
          </Link>

          {secondary && (
            <>
              <div className="flex w-full items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-2xs text-text-muted">also requires</span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="flex items-center gap-3">
                <GateLogo requires={missing[1]} />
                <p className="text-left text-sm text-text-muted">{secondary.subtitle}</p>
              </div>
              <Link to={secondary.href}>
                <Button variant="secondary" size="sm">
                  {secondary.cta}
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
