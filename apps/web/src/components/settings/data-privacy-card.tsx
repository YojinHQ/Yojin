import { useState, useCallback } from 'react';
import { useQuery } from 'urql';
import Card from '../common/card';
import Toggle from '../common/toggle';
import { GateCard } from '../common/feature-gate';
import { SecurityModal } from './security-modal';
import { ONBOARDING_STATUS_QUERY } from '../../api/documents';
import type { OnboardingStatusQueryResult } from '../../api/types';

export function DataPrivacyCard() {
  const [{ data: statusData }] = useQuery<OnboardingStatusQueryResult>({
    query: ONBOARDING_STATUS_QUERY,
  });
  const jintelConfigured = statusData?.onboardingStatus?.jintelConfigured ?? false;

  const [privacy, setPrivacy] = useState({
    piiRedaction: true,
    auditLogging: true,
  });

  const [securityOpen, setSecurityOpen] = useState(false);
  const closeSecurityModal = useCallback(() => setSecurityOpen(false), []);

  const updatePrivacy = (key: keyof typeof privacy) => (value: boolean) => {
    setPrivacy((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <>
      <div className="relative">
        <Card className="overflow-hidden p-0">
          {/* Header */}
          <div className="flex items-center gap-4 px-5 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-primary/10">
              <ShieldIcon />
            </div>
            <div>
              <h2 className="font-headline text-lg text-text-primary">Data & Privacy</h2>
              <p className="text-sm text-text-muted">Control how your data is handled and protected.</p>
            </div>
          </div>

          {/* Content */}
          <div className="border-t border-border px-5 py-4 space-y-4">
            <Toggle
              label="PII redaction"
              description="Strip personal identifiers before external API calls"
              checked={privacy.piiRedaction}
              onChange={updatePrivacy('piiRedaction')}
              disabled={!jintelConfigured}
            />
            <Toggle
              label="Audit logging"
              description="Log all security events to audit trail"
              checked={privacy.auditLogging}
              onChange={updatePrivacy('auditLogging')}
              disabled={!jintelConfigured}
            />
            <button
              onClick={() => setSecurityOpen(true)}
              className="flex cursor-pointer items-center gap-1 text-sm text-success transition-colors hover:text-success/80"
            >
              How Yojin protects your data
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
                />
              </svg>
            </button>
          </div>
        </Card>

        {!jintelConfigured && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-bg-primary/70 backdrop-blur-[3px]">
            <GateCard
              requires="jintel"
              subtitle="Jintel is free to use. Connect it to unlock live market data and analytics."
            />
          </div>
        )}
      </div>
      <SecurityModal open={securityOpen} onClose={closeSecurityModal} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Icon
// ---------------------------------------------------------------------------

function ShieldIcon() {
  return (
    <svg
      className="h-5 w-5 text-accent-primary"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
      />
    </svg>
  );
}
