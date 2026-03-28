import { useState, useCallback, useMemo } from 'react';
import { useMutation } from 'urql';
import { useOnboarding } from '../../lib/onboarding-context';
import { OnboardingShell } from '../../components/onboarding/onboarding-shell';
import { PlatformTile, PLATFORMS } from '../../components/onboarding/platform-tile';
import { DropZone } from '../../components/onboarding/drop-zone';
import { EditableTable } from '../../components/onboarding/editable-table';
import type { ExtractedPosition } from '../../components/onboarding/editable-table';
import Button from '../../components/common/button';
import Input from '../../components/common/input';
import { CONFIRM_POSITIONS_MUTATION, PARSE_PORTFOLIO_SCREENSHOT_MUTATION } from '../../api/documents';
import {
  sanitizeSymbol,
  sanitizeNumeric,
  sanitizePlatformName,
  validateEntries,
  type ManualEntryErrors,
} from '../../lib/manual-entry-validation';

type Screen = 'grid' | 'detail' | 'manual' | 'custom' | 'verify';

interface ManualEntry {
  symbol: string;
  name: string;
  quantity: string;
  avgEntry: string;
  marketPrice: string;
  marketValue: string;
}

const EMPTY_MANUAL: ManualEntry = {
  symbol: '',
  name: '',
  quantity: '',
  avgEntry: '',
  marketPrice: '',
  marketValue: '',
};

const CRYPTO_PLATFORMS = new Set(['COINBASE', 'BINANCE', 'METAMASK', 'PHANTOM']);

export function Step4Platforms() {
  const { state, updateState, nextStep, prevStep } = useOnboarding();
  const [, executeConfirmPositions] = useMutation(CONFIRM_POSITIONS_MUTATION);
  const [, executeParseScreenshot] = useMutation(PARSE_PORTFOLIO_SCREENSHOT_MUTATION);

  const [screen, setScreen] = useState<Screen>('grid');
  const [selectedPlatformId, setSelectedPlatformId] = useState<string | null>(null);
  const [extractedPositions, setExtractedPositions] = useState<ExtractedPosition[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string>();
  const [confirming, setConfirming] = useState(false);

  // Manual / custom entry state
  const [manualEntries, setManualEntries] = useState<ManualEntry[]>([{ ...EMPTY_MANUAL }]);
  const [customPlatformName, setCustomPlatformName] = useState('');
  const [entryErrors, setEntryErrors] = useState<ManualEntryErrors[]>([]);

  const connectedPlatforms = useMemo(() => state.platforms?.connected ?? [], [state.platforms?.connected]);
  const isConnected = (id: string) => connectedPlatforms.some((p) => p.platform === id);

  const selectedPlatform = PLATFORMS.find((p) => p.id === selectedPlatformId);

  const platformAssetClass =
    selectedPlatformId && CRYPTO_PLATFORMS.has(selectedPlatformId) ? ('crypto' as const) : ('equity' as const);

  const handlePlatformClick = (platformId: string) => {
    if (isConnected(platformId)) return;
    setSelectedPlatformId(platformId);
    setScreen('detail');
    setUploadError(undefined);
    setExtractedPositions([]);
    setManualEntries([{ ...EMPTY_MANUAL }]);
  };

  const handleScreenshot = useCallback(
    async (file: File) => {
      if (!selectedPlatformId) return;
      setUploading(true);
      setUploadError(undefined);
      try {
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1]); // strip data:... prefix
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const mutResult = await executeParseScreenshot({
          input: { image: base64, mediaType: file.type, platform: selectedPlatformId },
        });
        if (mutResult.error) {
          setUploadError(mutResult.error.message || 'Upload failed.');
          return;
        }
        const result = mutResult.data?.parsePortfolioScreenshot;
        if (result?.success && result.positions?.length) {
          setExtractedPositions(result.positions);
          setScreen('verify');
        } else {
          setUploadError(
            result?.error || 'Could not extract positions from this screenshot. Try again or add manually.',
          );
        }
      } catch {
        setUploadError('Upload failed. Check your connection.');
      } finally {
        setUploading(false);
      }
    },
    [selectedPlatformId, executeParseScreenshot],
  );

  const handleManualDone = () => {
    const { valid, errors } = validateEntries(manualEntries);
    setEntryErrors(errors);
    if (!valid) return;

    const positions: ExtractedPosition[] = manualEntries
      .filter((e) => e.symbol.trim())
      .map((e) => ({
        symbol: e.symbol.trim().toUpperCase(),
        name: e.name.trim(),
        quantity: e.quantity ? parseFloat(e.quantity) : null,
        avgEntry: e.avgEntry ? parseFloat(e.avgEntry) : null,
        marketPrice: e.marketPrice ? parseFloat(e.marketPrice) : null,
        marketValue: e.marketValue ? parseFloat(e.marketValue) : null,
      }));
    if (positions.length) {
      setExtractedPositions(positions);
      setScreen('verify');
    }
  };

  const handleConfirmPositions = useCallback(async () => {
    if (!selectedPlatformId || extractedPositions.length === 0) return;
    setConfirming(true);
    try {
      const result = await executeConfirmPositions({
        input: {
          platform: selectedPlatformId,
          positions: extractedPositions.map((p) => ({
            symbol: p.symbol,
            name: p.name,
            quantity: p.quantity,
            avgEntry: p.avgEntry,
            marketPrice: p.marketPrice,
            marketValue:
              p.marketValue ?? (p.quantity != null && p.marketPrice != null ? p.quantity * p.marketPrice : undefined),
          })),
        },
      });
      if (result.data?.confirmPositions) {
        const updated = [
          ...connectedPlatforms.filter((p) => p.platform !== selectedPlatformId),
          { platform: selectedPlatformId, positionCount: extractedPositions.length },
        ];
        updateState({ platforms: { connected: updated, skipped: false } });
        setScreen('grid');
        setSelectedPlatformId(null);
      } else if (result.error) {
        setUploadError(result.error.message || 'Failed to save positions. Please try again.');
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to save positions. Please try again.');
    } finally {
      setConfirming(false);
    }
  }, [selectedPlatformId, extractedPositions, connectedPlatforms, updateState, executeConfirmPositions]);

  const handleSkip = () => {
    updateState({ platforms: { connected: connectedPlatforms, skipped: connectedPlatforms.length === 0 } });
    nextStep();
  };

  const handleBack = () => {
    if (screen === 'detail' || screen === 'manual' || screen === 'custom') {
      setScreen('grid');
    } else if (screen === 'verify') {
      // Go back to whichever screen led to verify
      setScreen(selectedPlatformId && !PLATFORMS.some((p) => p.id === selectedPlatformId) ? 'custom' : 'detail');
    } else {
      prevStep();
    }
  };

  const updateManualEntry = (idx: number, field: keyof ManualEntry, value: string) => {
    const sanitized = field === 'symbol' ? sanitizeSymbol(value) : field === 'name' ? value : sanitizeNumeric(value);

    setManualEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, [field]: sanitized } : e)));

    // Clear error for the field being edited
    setEntryErrors((prev) => {
      const copy = [...prev];
      if (copy[idx]) {
        const { [field]: _, ...rest } = copy[idx];
        copy[idx] = rest;
      }
      return copy;
    });
  };

  const handleCustomPlatformClick = () => {
    setCustomPlatformName('');
    setManualEntries([{ ...EMPTY_MANUAL }]);
    setExtractedPositions([]);
    setScreen('custom');
  };

  const handleCustomDone = () => {
    const { valid, errors } = validateEntries(manualEntries);
    setEntryErrors(errors);
    if (!valid) return;

    const platformId = customPlatformName.trim().toUpperCase().replace(/\s+/g, '_');
    const positions: ExtractedPosition[] = manualEntries
      .filter((e) => e.symbol.trim())
      .map((e) => ({
        symbol: e.symbol.trim().toUpperCase(),
        name: e.name.trim(),
        quantity: e.quantity ? parseFloat(e.quantity) : null,
        avgEntry: e.avgEntry ? parseFloat(e.avgEntry) : null,
        marketPrice: e.marketPrice ? parseFloat(e.marketPrice) : null,
        marketValue: e.marketValue ? parseFloat(e.marketValue) : null,
      }));
    if (positions.length && platformId) {
      setSelectedPlatformId(platformId);
      setExtractedPositions(positions);
      setScreen('verify');
    }
  };

  const addManualRow = () => setManualEntries((prev) => [...prev, { ...EMPTY_MANUAL }]);

  const removeManualRow = (idx: number) => {
    if (manualEntries.length <= 1) return;
    setManualEntries((prev) => prev.filter((_, i) => i !== idx));
  };

  // --- Render screens ---

  // Platform Grid
  if (screen === 'grid') {
    return (
      <OnboardingShell currentStep={4}>
        <div className="w-full max-w-2xl">
          <div
            className="mb-8 text-center opacity-0 [animation:onboarding-fade-up_0.5s_ease-out_forwards]"
            style={{ animationDelay: '0ms' }}
          >
            <h1 className="mb-2 font-headline text-2xl text-text-primary">Add your portfolio</h1>
            <p className="text-sm text-text-secondary">You don't need to add credentials.</p>
          </div>

          <div
            className="mb-8 grid grid-cols-3 gap-3 sm:grid-cols-4 opacity-0 [animation:onboarding-fade-up_0.5s_ease-out_forwards]"
            style={{ animationDelay: '100ms' }}
          >
            {PLATFORMS.map((platform) => (
              <PlatformTile
                key={platform.id}
                platform={platform}
                connected={isConnected(platform.id)}
                onClick={() => handlePlatformClick(platform.id)}
              />
            ))}

            {/* Connected custom platforms */}
            {connectedPlatforms
              .filter((cp) => !PLATFORMS.some((p) => p.id === cp.platform))
              .map((cp) => {
                const displayName = cp.platform.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
                return (
                  <PlatformTile
                    key={cp.platform}
                    platform={{
                      id: cp.platform,
                      name: displayName,
                      domain: '',
                      instructions: [],
                    }}
                    connected
                    onClick={() => {}}
                  />
                );
              })}

            {/* Custom platform tile */}
            <button
              type="button"
              onClick={handleCustomPlatformClick}
              className="group cursor-pointer flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border p-5 transition-all duration-200 hover:border-accent-primary/40 hover:bg-bg-hover/40 hover:shadow-[0_0_16px_var(--color-accent-glow)]"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-bg-tertiary transition-colors group-hover:bg-accent-primary/20 group-hover:text-accent-primary">
                <svg
                  className="h-5 w-5 text-text-muted group-hover:text-accent-primary"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </div>
              <span className="text-xs font-medium text-text-muted transition-colors group-hover:text-accent-primary">
                Custom
              </span>
            </button>
          </div>

          <div className="flex items-center justify-between">
            <Button variant="ghost" size="md" onClick={prevStep}>
              <svg className="mr-1 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
              </svg>
              Back
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" size="md" onClick={handleSkip}>
                Skip
              </Button>
              {connectedPlatforms.length > 0 && (
                <Button variant="primary" size="md" onClick={handleSkip}>
                  Continue
                  <svg className="ml-1 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                  </svg>
                </Button>
              )}
            </div>
          </div>
        </div>
      </OnboardingShell>
    );
  }

  // Platform Detail
  if (screen === 'detail' && selectedPlatform) {
    return (
      <OnboardingShell currentStep={4}>
        <div className="w-full max-w-lg">
          <div
            className="mb-6 opacity-0 [animation:onboarding-fade-up_0.5s_ease-out_forwards]"
            style={{ animationDelay: '0ms' }}
          >
            <h1 className="font-headline text-2xl text-text-primary">{selectedPlatform.name}</h1>
            <ol className="mb-6 space-y-2">
              {selectedPlatform.instructions.map((step, i) => (
                <li key={i} className="flex gap-3 text-sm text-text-secondary">
                  <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-bg-tertiary text-3xs font-medium text-text-muted">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>

          <div
            className="mb-6 opacity-0 [animation:onboarding-fade-up_0.5s_ease-out_forwards]"
            style={{ animationDelay: '100ms' }}
          >
            <DropZone onUpload={handleScreenshot} loading={uploading} error={uploadError} />
          </div>

          <div className="flex items-center justify-between">
            <Button variant="ghost" size="md" onClick={handleBack}>
              <svg className="mr-1 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
              </svg>
              Back
            </Button>
            <Button variant="secondary" size="md" onClick={() => setScreen('manual')}>
              Add manually
            </Button>
          </div>
        </div>
      </OnboardingShell>
    );
  }

  // Manual Entry
  if (screen === 'manual') {
    const hasValidEntries = manualEntries.some((e) => e.symbol.trim());
    return (
      <OnboardingShell currentStep={4}>
        <div className="w-full max-w-2xl">
          <div className="mb-6">
            <h1 className="mb-2 font-headline text-2xl text-text-primary">Add positions — {selectedPlatform?.name}</h1>
            <p className="text-sm text-text-secondary">Enter your holdings manually.</p>
          </div>

          <div className="mb-6 space-y-3">
            {manualEntries.map((entry, idx) => {
              const rowErrors = entryErrors[idx] ?? {};
              return (
                <div key={idx} className="flex items-end gap-2 rounded-lg border border-border bg-bg-card p-3">
                  <Input
                    label={idx === 0 ? 'Symbol' : undefined}
                    placeholder="AAPL"
                    value={entry.symbol}
                    onChange={(e) => updateManualEntry(idx, 'symbol', e.target.value)}
                    error={rowErrors.symbol}
                    size="sm"
                    className="w-20"
                  />
                  <Input
                    label={idx === 0 ? 'Name' : undefined}
                    placeholder="Apple Inc."
                    value={entry.name}
                    onChange={(e) => updateManualEntry(idx, 'name', e.target.value)}
                    size="sm"
                    className="flex-1"
                  />
                  <Input
                    label={idx === 0 ? 'Qty' : undefined}
                    placeholder="10"
                    inputMode="decimal"
                    value={entry.quantity}
                    onChange={(e) => updateManualEntry(idx, 'quantity', e.target.value)}
                    error={rowErrors.quantity}
                    size="sm"
                    className="w-20"
                  />
                  <Input
                    label={idx === 0 ? 'Avg Entry' : undefined}
                    placeholder="150.00"
                    inputMode="decimal"
                    value={entry.avgEntry}
                    onChange={(e) => updateManualEntry(idx, 'avgEntry', e.target.value)}
                    error={rowErrors.avgEntry}
                    size="sm"
                    className="w-24"
                  />
                  <Input
                    label={idx === 0 ? 'Mkt Price' : undefined}
                    placeholder="175.00"
                    inputMode="decimal"
                    value={entry.marketPrice}
                    onChange={(e) => updateManualEntry(idx, 'marketPrice', e.target.value)}
                    error={rowErrors.marketPrice}
                    size="sm"
                    className="w-24"
                  />
                  <Input
                    label={idx === 0 ? 'Value' : undefined}
                    placeholder="1500.00"
                    inputMode="decimal"
                    value={entry.marketValue}
                    onChange={(e) => updateManualEntry(idx, 'marketValue', e.target.value)}
                    error={rowErrors.marketValue}
                    size="sm"
                    className="w-24"
                  />
                  {manualEntries.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeManualRow(idx)}
                      className="cursor-pointer mb-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-text-muted hover:bg-error/10 hover:text-error"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              onClick={addManualRow}
              className="cursor-pointer flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2.5 text-sm text-text-muted transition-colors hover:border-accent-primary/30 hover:bg-bg-hover/40 hover:text-text-secondary"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add another
            </button>
          </div>

          <div className="flex items-center justify-between">
            <Button variant="ghost" size="md" onClick={handleBack}>
              <svg className="mr-1 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
              </svg>
              Back
            </Button>
            <Button variant="primary" size="md" disabled={!hasValidEntries} onClick={handleManualDone}>
              Review positions
              <svg className="ml-1 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
            </Button>
          </div>
        </div>
      </OnboardingShell>
    );
  }

  // Custom Platform Entry
  if (screen === 'custom') {
    const hasValidEntries = manualEntries.some((e) => e.symbol.trim());
    const hasName = customPlatformName.trim().length > 0;
    return (
      <OnboardingShell currentStep={4}>
        <div className="w-full max-w-2xl">
          <div className="mb-6">
            <h1 className="mb-2 font-headline text-2xl text-text-primary">Add custom platform</h1>
            <p className="text-sm text-text-secondary">Name your platform and enter your holdings.</p>
          </div>

          <div className="mb-6">
            <Input
              label="Platform name"
              placeholder="e.g. eToro, Vanguard, My 401k"
              value={customPlatformName}
              onChange={(e) => setCustomPlatformName(sanitizePlatformName(e.target.value))}
              size="md"
            />
          </div>

          <div className="mb-2">
            <p className="text-sm font-medium text-text-secondary">Positions</p>
          </div>

          <div className="mb-6 space-y-3">
            {manualEntries.map((entry, idx) => {
              const rowErrors = entryErrors[idx] ?? {};
              return (
                <div key={idx} className="flex items-end gap-2 rounded-lg border border-border bg-bg-card p-3">
                  <Input
                    label={idx === 0 ? 'Symbol' : undefined}
                    placeholder="AAPL"
                    value={entry.symbol}
                    onChange={(e) => updateManualEntry(idx, 'symbol', e.target.value)}
                    error={rowErrors.symbol}
                    size="sm"
                    className="w-20"
                  />
                  <Input
                    label={idx === 0 ? 'Name' : undefined}
                    placeholder="Apple Inc."
                    value={entry.name}
                    onChange={(e) => updateManualEntry(idx, 'name', e.target.value)}
                    size="sm"
                    className="flex-1"
                  />
                  <Input
                    label={idx === 0 ? 'Qty' : undefined}
                    placeholder="10"
                    inputMode="decimal"
                    value={entry.quantity}
                    onChange={(e) => updateManualEntry(idx, 'quantity', e.target.value)}
                    error={rowErrors.quantity}
                    size="sm"
                    className="w-20"
                  />
                  <Input
                    label={idx === 0 ? 'Avg Entry' : undefined}
                    placeholder="150.00"
                    inputMode="decimal"
                    value={entry.avgEntry}
                    onChange={(e) => updateManualEntry(idx, 'avgEntry', e.target.value)}
                    error={rowErrors.avgEntry}
                    size="sm"
                    className="w-24"
                  />
                  <Input
                    label={idx === 0 ? 'Mkt Price' : undefined}
                    placeholder="175.00"
                    inputMode="decimal"
                    value={entry.marketPrice}
                    onChange={(e) => updateManualEntry(idx, 'marketPrice', e.target.value)}
                    error={rowErrors.marketPrice}
                    size="sm"
                    className="w-24"
                  />
                  <Input
                    label={idx === 0 ? 'Value' : undefined}
                    placeholder="1500.00"
                    inputMode="decimal"
                    value={entry.marketValue}
                    onChange={(e) => updateManualEntry(idx, 'marketValue', e.target.value)}
                    error={rowErrors.marketValue}
                    size="sm"
                    className="w-24"
                  />
                  {manualEntries.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeManualRow(idx)}
                      className="cursor-pointer mb-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-text-muted hover:bg-error/10 hover:text-error"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              onClick={addManualRow}
              className="cursor-pointer flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2.5 text-sm text-text-muted transition-colors hover:border-accent-primary/30 hover:bg-bg-hover/40 hover:text-text-secondary"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add another
            </button>
          </div>

          <div className="flex items-center justify-between">
            <Button variant="ghost" size="md" onClick={handleBack}>
              <svg className="mr-1 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
              </svg>
              Back
            </Button>
            <Button variant="primary" size="md" disabled={!hasName || !hasValidEntries} onClick={handleCustomDone}>
              Review positions
              <svg className="ml-1 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
            </Button>
          </div>
        </div>
      </OnboardingShell>
    );
  }

  // Verify Positions
  const verifyPlatformName = selectedPlatform?.name ?? customPlatformName.trim();
  if (screen === 'verify' && (selectedPlatform || verifyPlatformName)) {
    return (
      <OnboardingShell currentStep={4}>
        <div className="w-full max-w-2xl">
          <div className="mb-6">
            <h1 className="mb-2 font-headline text-2xl text-text-primary">
              Verify your positions — {verifyPlatformName}
            </h1>
            <p className="text-sm text-text-secondary">Review what Yojin extracted. Edit anything that looks off.</p>
          </div>

          <div className="mb-6">
            <EditableTable
              positions={extractedPositions}
              onChange={setExtractedPositions}
              assetClass={platformAssetClass}
            />
          </div>

          <div className="flex items-center justify-between">
            <Button variant="ghost" size="md" onClick={handleBack}>
              <svg className="mr-1 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
              </svg>
              Back
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={confirming}
              disabled={extractedPositions.length === 0}
              onClick={handleConfirmPositions}
            >
              Confirm
              <svg className="ml-1 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </Button>
          </div>
        </div>
      </OnboardingShell>
    );
  }

  // Fallback
  return null;
}
