import { useState } from 'react';
import { useNavigate } from 'react-router';

import { useConnectPlatform, useDetectAvailableTiers } from '../../api/hooks/use-connections';
import type { IntegrationTier, Platform, TierAvailability } from '../../api/types';
import { KNOWN_PLATFORMS } from '../../api/types';
import Badge from '../common/badge';
import Button from '../common/button';
import Input from '../common/input';
import Modal from '../common/modal';
import Spinner from '../common/spinner';
import { PlatformLogo } from './platform-logos';
import { getPlatformMeta } from './platform-meta';

interface AddPlatformModalProps {
  open: boolean;
  onClose: () => void;
  /** Platforms already connected — hidden from the selector. */
  connectedPlatforms: readonly Platform[];
}

type Step = 'select-platform' | 'select-tier' | 'enter-credentials' | 'connecting';

/** Platforms shown in the modal (exclude MANUAL). */
const DISPLAY_PLATFORMS = KNOWN_PLATFORMS.filter((p) => p !== 'MANUAL');

/** Human-readable labels for integration tiers. */
const TIER_INFO: Record<IntegrationTier, { label: string; description: string; icon: string }> = {
  CLI: {
    label: 'CLI',
    description: 'Connect via local gateway or CLI tool',
    icon: 'M6.75 7.5l3 2.25-3 2.25m4.5 0h3M3.75 4.5h16.5c.621 0 1.125.504 1.125 1.125v12.75c0 .621-.504 1.125-1.125 1.125H3.75c-.621 0-1.125-.504-1.125-1.125V5.625c0-.621.504-1.125 1.125-1.125z',
  },
  API: {
    label: 'API Keys',
    description: 'Connect with your API credentials',
    icon: 'M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25z',
  },
  UI: {
    label: 'Browser',
    description: 'Yojin uses your browser to fetch positions',
    icon: 'M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5a17.92 17.92 0 0 1-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418',
  },
  SCREENSHOT: {
    label: 'Screenshot',
    description: 'Paste a screenshot in the chat — AI extracts positions',
    icon: 'm2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z',
  },
};

/** Human-readable labels for credential keys. */
function credentialLabel(key: string): string {
  const cleaned = key
    .replace(/^(BINANCE|COINBASE|IBKR|ROBINHOOD|SCHWAB|FIDELITY|POLYMARKET|PHANTOM)_/, '')
    .replace(/_/g, ' ');
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

export function AddPlatformModal({ open, onClose, connectedPlatforms }: AddPlatformModalProps) {
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('select-platform');
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | null>(null);
  const [selectedTier, setSelectedTier] = useState<IntegrationTier | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [connectError, setConnectError] = useState<string | null>(null);

  const [{ data: tiersData, fetching: tiersFetching }] = useDetectAvailableTiers(selectedPlatform ?? '');
  const [, connectPlatform] = useConnectPlatform();

  const available = DISPLAY_PLATFORMS.filter((p) => !connectedPlatforms.includes(p));
  const tiers: TierAvailability[] = tiersData?.detectAvailableTiers ?? [];

  function reset() {
    setStep('select-platform');
    setSelectedPlatform(null);
    setSelectedTier(null);
    setCredentials({});
    setConnectError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleSelectPlatform(platform: Platform) {
    setSelectedPlatform(platform);
    setStep('select-tier');
  }

  function handleSelectTier(tier: TierAvailability) {
    setSelectedTier(tier.tier);

    if (tier.tier === 'SCREENSHOT') {
      handleClose();
      navigate('/chat');
      return;
    }

    if (tier.requiresCredentials.length > 0) {
      // Initialize credential fields
      const init: Record<string, string> = {};
      for (const key of tier.requiresCredentials) {
        init[key] = '';
      }
      setCredentials(init);
      setStep('enter-credentials');
    } else {
      // No credentials needed — connect directly
      void handleConnect(tier.tier);
    }
  }

  async function handleConnect(tier?: IntegrationTier) {
    if (!selectedPlatform) return;
    const connectTier = tier ?? selectedTier;
    if (!connectTier) return;

    setStep('connecting');
    setConnectError(null);

    // Convert credentials Record to [{ key, value }] for GraphQL
    const credentialList = Object.entries(credentials)
      .filter(([, v]) => v.trim().length > 0)
      .map(([key, value]) => ({ key, value }));

    const result = await connectPlatform({
      input: {
        platform: selectedPlatform,
        tier: connectTier,
        ...(credentialList.length > 0 ? { credentials: credentialList } : {}),
      },
    });

    if (result.error || !result.data?.connectPlatform.success) {
      setConnectError(result.data?.connectPlatform.error ?? result.error?.message ?? 'Connection failed');
      setStep(Object.keys(credentials).length > 0 ? 'enter-credentials' : 'select-tier');
      return;
    }

    handleClose();
  }

  function handleBack() {
    setConnectError(null);
    if (step === 'select-tier') {
      setSelectedPlatform(null);
      setStep('select-platform');
    } else if (step === 'enter-credentials') {
      setSelectedTier(null);
      setCredentials({});
      setStep('select-tier');
    }
  }

  const title =
    step === 'select-platform'
      ? 'Connect Platform'
      : step === 'select-tier'
        ? `Connect ${selectedPlatform ? getPlatformMeta(selectedPlatform).label : ''}`
        : step === 'enter-credentials'
          ? 'Enter Credentials'
          : 'Connecting...';

  return (
    <Modal open={open} onClose={handleClose} title={title} maxWidth="max-w-md">
      {/* Back button */}
      {(step === 'select-tier' || step === 'enter-credentials') && (
        <button
          onClick={handleBack}
          className="mb-4 flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Back
        </button>
      )}

      {/* Step 1: Select platform */}
      {step === 'select-platform' && (
        <div className="space-y-3">
          {available.length === 0 ? (
            <p className="py-4 text-center text-sm text-text-muted">All supported platforms are already connected.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {available.map((platform) => {
                const meta = getPlatformMeta(platform);
                return (
                  <button
                    key={platform}
                    onClick={() => handleSelectPlatform(platform)}
                    className="flex items-center gap-3 rounded-xl border border-border bg-bg-card p-3 text-left transition-colors hover:border-accent-primary hover:bg-bg-hover"
                  >
                    <PlatformLogo platform={platform} size="sm" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">{meta.label}</p>
                      <p className="text-2xs text-text-muted truncate">{meta.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Step 2: Select integration tier */}
      {step === 'select-tier' && (
        <div className="space-y-3">
          {tiersFetching ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : tiers.length === 0 ? (
            <p className="py-4 text-center text-sm text-text-muted">No integration methods available.</p>
          ) : (
            <div className="space-y-2">
              {tiers.map((tier) => {
                const info = TIER_INFO[tier.tier];
                return (
                  <button
                    key={tier.tier}
                    onClick={() => handleSelectTier(tier)}
                    disabled={!tier.available}
                    className="flex w-full items-center gap-3 rounded-xl border border-border bg-bg-card p-3 text-left transition-colors hover:border-accent-primary hover:bg-bg-hover disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:bg-bg-card"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bg-tertiary">
                      <svg
                        className="h-4.5 w-4.5 text-text-secondary"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.5}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d={info.icon} />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text-primary">{info.label}</span>
                        {!tier.available && (
                          <Badge variant="neutral" size="xs">
                            Unavailable
                          </Badge>
                        )}
                      </div>
                      <p className="text-2xs text-text-muted">{info.description}</p>
                    </div>
                    {tier.available && (
                      <svg
                        className="h-4 w-4 shrink-0 text-text-muted"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Step 3: Enter credentials */}
      {step === 'enter-credentials' && selectedTier && (
        <div className="space-y-4">
          {connectError && <div className="rounded-lg bg-error/10 px-3 py-2 text-sm text-error">{connectError}</div>}

          <div className="space-y-3">
            {Object.keys(credentials).map((key) => (
              <Input
                key={key}
                label={credentialLabel(key)}
                type={
                  key.toLowerCase().includes('secret') || key.toLowerCase().includes('password') ? 'password' : 'text'
                }
                placeholder={key}
                value={credentials[key]}
                onChange={(e) => setCredentials((prev) => ({ ...prev, [key]: e.target.value }))}
                size="sm"
              />
            ))}
          </div>

          <p className="text-2xs text-text-muted">
            Credentials are encrypted locally (AES-256-GCM) and never sent to external servers.
          </p>

          <Button
            size="sm"
            className="w-full"
            onClick={() => void handleConnect()}
            disabled={Object.values(credentials).some((v) => !v.trim())}
          >
            Connect {selectedPlatform ? getPlatformMeta(selectedPlatform).label : ''}
          </Button>
        </div>
      )}

      {/* Step 4: Connecting */}
      {step === 'connecting' && (
        <div className="flex flex-col items-center gap-4 py-6">
          {selectedTier === 'UI' ? (
            <>
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-primary/10">
                <svg
                  className="h-7 w-7 text-accent-primary animate-pulse"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5a17.92 17.92 0 0 1-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418"
                  />
                </svg>
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-medium text-text-primary">
                  Log in to {selectedPlatform ? getPlatformMeta(selectedPlatform).label : ''}
                </p>
                <p className="text-xs text-text-muted max-w-xs">
                  A browser window has opened. Log in and complete any 2FA prompts. Yojin will detect when you're done
                  automatically.
                </p>
              </div>
              <Spinner size="sm" />
              <p className="text-2xs text-text-muted">Waiting for login...</p>
            </>
          ) : (
            <>
              <Spinner size="lg" />
              <p className="text-sm text-text-secondary">
                Connecting to {selectedPlatform ? getPlatformMeta(selectedPlatform).label : ''}...
              </p>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
