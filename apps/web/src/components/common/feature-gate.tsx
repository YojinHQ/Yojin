import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useFeatureStatus } from '../../lib/feature-status';
import { GATES, GateLogo, getMissing, type GateRequirement } from '../../lib/gate-config';
import Button from './button';

// ─── Card-level gate (used inside CardBlurGate overlay) ─────
// CardBlurGate provides the card container, so this is just the content.

export function FeatureCardGate({ requires }: { requires: GateRequirement }) {
  const items: ('jintel' | 'ai')[] = requires === 'both' ? ['jintel', 'ai'] : [requires];
  const primary = GATES[items[0]];

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <GateLogo requires={items[0]} size="sm" />
      <div>
        <p className="text-sm font-medium text-text-primary">{primary.title}</p>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">{primary.subtitle}</p>
      </div>
      {items.length > 1 && <p className="text-xs leading-relaxed text-text-muted">{GATES[items[1]].subtitle}</p>}
      <div className="flex items-center gap-2">
        {items.map((req) => (
          <Link key={req} to={GATES[req].href}>
            <Button size="sm" variant="secondary">
              {GATES[req].cta}
            </Button>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─── Page-level gate (full-page centered) ───────────────────

export function PageFeatureGate({ requires, children }: { requires: GateRequirement; children: ReactNode }) {
  const { jintelConfigured, aiConfigured, loading } = useFeatureStatus();

  if (loading) return null;

  const missing = getMissing(requires, jintelConfigured, aiConfigured);
  if (missing.length === 0) return <>{children}</>;

  const primary = GATES[missing[0]];
  const secondary = missing.length > 1 ? GATES[missing[1]] : null;

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-4 rounded-2xl border border-border bg-bg-card px-8 py-8 text-center shadow-lg">
        <GateLogo requires={missing[0]} size="sm" />
        <div>
          <h2 className="text-base font-medium text-text-primary">{primary.title}</h2>
          <p className="mt-1.5 text-sm text-text-muted">{primary.subtitle}</p>
        </div>

        <Link to={primary.href}>
          <Button variant="primary" size="sm">
            {primary.cta}
          </Button>
        </Link>

        {secondary && (
          <>
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-2xs text-text-muted">also requires</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <div className="flex items-center gap-3">
              <GateLogo requires={missing[1]} size="sm" />
              <div className="text-left">
                <p className="text-sm text-text-muted">{secondary.subtitle}</p>
              </div>
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
  );
}

// ─── Branded gate card (standalone, for use in any overlay) ──

interface GateCardProps {
  requires: 'jintel' | 'ai';
  title?: string;
  subtitle?: string;
  cta?: string;
  href?: string;
  action?: ReactNode;
}

export function GateCard({ requires, title, subtitle, cta, href, action }: GateCardProps) {
  const gate = GATES[requires];
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-bg-card/95 px-6 py-5 text-center shadow-lg backdrop-blur-sm">
      <GateLogo requires={requires} size="sm" />
      <div>
        <p className="text-sm font-medium text-text-primary">{title ?? gate.title}</p>
        <p className="mt-1 max-w-[260px] text-xs leading-relaxed text-text-muted">{subtitle ?? gate.subtitle}</p>
      </div>
      {action ?? (
        <Link to={href ?? gate.href}>
          <Button size="sm" variant="secondary">
            {cta ?? gate.cta}
          </Button>
        </Link>
      )}
    </div>
  );
}
