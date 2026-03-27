import { useEffect, useRef, useState } from 'react';

import { useConnectPlatform, useDetectAvailableTiers } from '../../api/hooks/use-connections';
import type { Platform } from '../../api/types';
import { KNOWN_PLATFORMS } from '../../api/types';
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

type Step = 'select-platform' | 'enter-credentials' | 'connecting';

/** Platforms shown in the modal (exclude MANUAL). */
const DISPLAY_PLATFORMS = KNOWN_PLATFORMS.filter((p) => p !== 'MANUAL');

/** Human-readable labels for credential keys. */
function credentialLabel(key: string): string {
  const cleaned = key
    .replace(/^(BINANCE|COINBASE|IBKR|ROBINHOOD|SCHWAB|FIDELITY|POLYMARKET|PHANTOM)_/, '')
    .replace(/_/g, ' ');
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

export function AddPlatformModal({ open, onClose, connectedPlatforms }: AddPlatformModalProps) {
  const [step, setStep] = useState<Step>('select-platform');
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [connectError, setConnectError] = useState<string | null>(null);

  const [{ data: tiersData, fetching: tiersFetching }] = useDetectAvailableTiers(selectedPlatform ?? '');
  const [, connectPlatform] = useConnectPlatform();

  const available = DISPLAY_PLATFORMS.filter((p) => !connectedPlatforms.includes(p));

  // Derive API tier info from query data — no effect needed
  const apiTier = tiersData?.detectAvailableTiers?.find((t) => t.tier === 'API');
  const apiUnavailable = !tiersFetching && !!tiersData?.detectAvailableTiers && !apiTier;
  const requiredKeys = apiTier?.requiresCredentials ?? [];

  const autoConnectingRef = useRef(false);

  function reset() {
    setStep('select-platform');
    setSelectedPlatform(null);
    setCredentials({});
    setConnectError(null);
    autoConnectingRef.current = false;
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleSelectPlatform(platform: Platform) {
    setSelectedPlatform(platform);
    setCredentials({});
    setConnectError(null);
    setStep('enter-credentials');
  }

  async function handleConnect() {
    if (!selectedPlatform) return;

    setStep('connecting');
    setConnectError(null);

    // Convert credentials Record to [{ key, value }] for GraphQL
    const credentialList = Object.entries(credentials)
      .filter(([, v]) => v.trim().length > 0)
      .map(([key, value]) => ({ key, value }));

    const result = await connectPlatform({
      input: {
        platform: selectedPlatform,
        tier: 'API' as const,
        ...(credentialList.length > 0 ? { credentials: credentialList } : {}),
      },
    });

    if (result.error || !result.data?.connectPlatform.success) {
      setConnectError(result.data?.connectPlatform.error ?? result.error?.message ?? 'Connection failed');
      setStep('enter-credentials');
      return;
    }

    handleClose();
  }

  // Auto-connect when API tier requires no credentials.
  // setTimeout defers the setState calls in handleConnect out of the
  // synchronous effect body, satisfying react-hooks/set-state-in-effect.
  useEffect(() => {
    if (
      step === 'enter-credentials' &&
      !tiersFetching &&
      apiTier &&
      requiredKeys.length === 0 &&
      !autoConnectingRef.current
    ) {
      autoConnectingRef.current = true;
      const timer = setTimeout(() => void handleConnect(), 0);
      return () => clearTimeout(timer);
    }
  });

  function handleBack() {
    setConnectError(null);
    setSelectedPlatform(null);
    setCredentials({});
    setStep('select-platform');
  }

  const title =
    step === 'select-platform' ? 'Connect Platform' : step === 'enter-credentials' ? `Enter API Keys` : 'Connecting...';

  return (
    <Modal open={open} onClose={handleClose} title={title} maxWidth="max-w-md">
      {/* Back button */}
      {step === 'enter-credentials' && (
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

      {/* Step 2: Enter API credentials */}
      {step === 'enter-credentials' && (
        <div className="space-y-4">
          {connectError && <div className="rounded-lg bg-error/10 px-3 py-2 text-sm text-error">{connectError}</div>}

          {tiersFetching ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : apiUnavailable ? (
            <p className="py-4 text-center text-sm text-text-muted">
              API key connection is not available for this platform.
            </p>
          ) : requiredKeys.length === 0 ? (
            <p className="py-4 text-center text-sm text-text-muted">No API credentials required — connecting...</p>
          ) : (
            <>
              <div className="space-y-3">
                {requiredKeys.map((key) => (
                  <Input
                    key={key}
                    label={credentialLabel(key)}
                    type={
                      key.toLowerCase().includes('secret') || key.toLowerCase().includes('password')
                        ? 'password'
                        : 'text'
                    }
                    placeholder={key}
                    value={credentials[key] ?? ''}
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
                disabled={requiredKeys.some((key) => !(credentials[key] ?? '').trim())}
              >
                Connect {selectedPlatform ? getPlatformMeta(selectedPlatform).label : ''}
              </Button>
            </>
          )}
        </div>
      )}

      {/* Step 3: Connecting */}
      {step === 'connecting' && (
        <div className="flex flex-col items-center gap-4 py-6">
          <Spinner size="lg" />
          <p className="text-sm text-text-secondary">
            Connecting to {selectedPlatform ? getPlatformMeta(selectedPlatform).label : ''}...
          </p>
        </div>
      )}
    </Modal>
  );
}
