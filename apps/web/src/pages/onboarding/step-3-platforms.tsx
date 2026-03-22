import { useState, useCallback } from 'react';
import { useOnboarding } from '../../lib/onboarding-context';
import { OnboardingShell } from '../../components/onboarding/onboarding-shell';
import { PlatformTile, PLATFORMS } from '../../components/onboarding/platform-tile';
import { DropZone } from '../../components/onboarding/drop-zone';
import { EditableTable } from '../../components/onboarding/editable-table';
import type { ExtractedPosition } from '../../components/onboarding/editable-table';
import Button from '../../components/common/button';
import Input from '../../components/common/input';

type Screen = 'grid' | 'detail' | 'manual' | 'verify';

interface ManualEntry {
  symbol: string;
  name: string;
  quantity: string;
  avgEntry: string;
  marketValue: string;
}

const EMPTY_MANUAL: ManualEntry = { symbol: '', name: '', quantity: '', avgEntry: '', marketValue: '' };

export function Step3Platforms() {
  const { state, updateState, nextStep, prevStep } = useOnboarding();

  const [screen, setScreen] = useState<Screen>('grid');
  const [selectedPlatformId, setSelectedPlatformId] = useState<string | null>(null);
  const [extractedPositions, setExtractedPositions] = useState<ExtractedPosition[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string>();
  const [confirming, setConfirming] = useState(false);

  // Manual entry state
  const [manualEntries, setManualEntries] = useState<ManualEntry[]>([{ ...EMPTY_MANUAL }]);

  const connectedPlatforms = state.platforms?.connected ?? [];
  const isConnected = (id: string) => connectedPlatforms.some((p) => p.platform === id);

  const selectedPlatform = PLATFORMS.find((p) => p.id === selectedPlatformId);

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

        const res = await fetch('/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `mutation ($input: ScreenshotInput!) { parsePortfolioScreenshot(input: $input) { success positions { symbol name quantity avgEntry marketValue } confidence warnings error } }`,
            variables: {
              input: { image: base64, mediaType: file.type, platform: selectedPlatformId },
            },
          }),
        });
        const json = await res.json();
        const result = json?.data?.parsePortfolioScreenshot;
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
    [selectedPlatformId],
  );

  const handleManualDone = () => {
    const positions: ExtractedPosition[] = manualEntries
      .filter((e) => e.symbol.trim())
      .map((e) => ({
        symbol: e.symbol.trim().toUpperCase(),
        name: e.name.trim(),
        quantity: e.quantity ? parseFloat(e.quantity) : null,
        avgEntry: e.avgEntry ? parseFloat(e.avgEntry) : null,
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
      const res = await fetch('/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `mutation ($input: ConfirmPositionsInput!) { confirmPositions(input: $input) }`,
          variables: {
            input: {
              platform: selectedPlatformId,
              positions: extractedPositions.map((p) => ({
                symbol: p.symbol,
                name: p.name,
                quantity: p.quantity,
                avgEntry: p.avgEntry,
                marketValue: p.marketValue,
              })),
            },
          },
        }),
      });
      const json = await res.json();
      if (json?.data?.confirmPositions) {
        const updated = [
          ...connectedPlatforms.filter((p) => p.platform !== selectedPlatformId),
          { platform: selectedPlatformId, positionCount: extractedPositions.length },
        ];
        updateState({ platforms: { connected: updated, skipped: false } });
        setScreen('grid');
        setSelectedPlatformId(null);
      }
    } catch {
      // Silently handle — user can retry
    } finally {
      setConfirming(false);
    }
  }, [selectedPlatformId, extractedPositions, connectedPlatforms, updateState]);

  const handleSkip = () => {
    updateState({ platforms: { connected: connectedPlatforms, skipped: connectedPlatforms.length === 0 } });
    nextStep();
  };

  const handleBack = () => {
    if (screen === 'detail' || screen === 'manual') {
      setScreen('grid');
    } else if (screen === 'verify') {
      setScreen('detail');
    } else {
      prevStep();
    }
  };

  const updateManualEntry = (idx: number, field: keyof ManualEntry, value: string) => {
    setManualEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, [field]: value } : e)));
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
      <OnboardingShell currentStep={3}>
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
      <OnboardingShell currentStep={3}>
        <div className="w-full max-w-lg">
          <div
            className="mb-6 opacity-0 [animation:onboarding-fade-up_0.5s_ease-out_forwards]"
            style={{ animationDelay: '0ms' }}
          >
            <h1 className="mb-2 font-headline text-2xl text-text-primary">{selectedPlatform.name}</h1>
            <p className="mb-4 text-sm text-text-secondary">Add with screenshot</p>
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
      <OnboardingShell currentStep={3}>
        <div className="w-full max-w-2xl">
          <div className="mb-6">
            <h1 className="mb-2 font-headline text-2xl text-text-primary">Add positions — {selectedPlatform?.name}</h1>
            <p className="text-sm text-text-secondary">Enter your holdings manually.</p>
          </div>

          <div className="mb-6 space-y-3">
            {manualEntries.map((entry, idx) => (
              <div key={idx} className="flex items-end gap-2 rounded-lg border border-border bg-bg-card p-3">
                <Input
                  label={idx === 0 ? 'Symbol' : undefined}
                  placeholder="AAPL"
                  value={entry.symbol}
                  onChange={(e) => updateManualEntry(idx, 'symbol', e.target.value)}
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
                  value={entry.quantity}
                  onChange={(e) => updateManualEntry(idx, 'quantity', e.target.value)}
                  size="sm"
                  className="w-20"
                />
                <Input
                  label={idx === 0 ? 'Avg Entry' : undefined}
                  placeholder="150.00"
                  value={entry.avgEntry}
                  onChange={(e) => updateManualEntry(idx, 'avgEntry', e.target.value)}
                  size="sm"
                  className="w-24"
                />
                <Input
                  label={idx === 0 ? 'Value' : undefined}
                  placeholder="1500.00"
                  value={entry.marketValue}
                  onChange={(e) => updateManualEntry(idx, 'marketValue', e.target.value)}
                  size="sm"
                  className="w-24"
                />
                {manualEntries.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeManualRow(idx)}
                    className="mb-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-text-muted hover:bg-error/10 hover:text-error"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={addManualRow}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2.5 text-sm text-text-muted transition-colors hover:border-border-light hover:text-text-secondary"
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

  // Verify Positions
  if (screen === 'verify' && selectedPlatform) {
    return (
      <OnboardingShell currentStep={3}>
        <div className="w-full max-w-2xl">
          <div className="mb-6">
            <h1 className="mb-2 font-headline text-2xl text-text-primary">
              Verify your positions — {selectedPlatform.name}
            </h1>
            <p className="text-sm text-text-secondary">Review what Yojin extracted. Edit anything that looks off.</p>
          </div>

          <div className="mb-6">
            <EditableTable positions={extractedPositions} onChange={setExtractedPositions} />
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
