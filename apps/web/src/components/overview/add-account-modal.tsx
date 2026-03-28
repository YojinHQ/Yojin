import { useState, useCallback } from 'react';
import { useMutation } from 'urql';
import Modal from '../common/modal';
import Button from '../common/button';
import Input from '../common/input';
import { PlatformTile, PLATFORMS } from '../onboarding/platform-tile';
import { PlatformLogo } from '../platforms/platform-logos';
import { DropZone } from '../onboarding/drop-zone';
import { EditableTable } from '../onboarding/editable-table';
import type { ExtractedPosition } from '../onboarding/editable-table';
import { CONFIRM_POSITIONS_MUTATION, PARSE_PORTFOLIO_SCREENSHOT_MUTATION } from '../../api/documents';
import { lookupSymbolName } from '../../lib/symbol-names';
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

function lookupName(symbol: string): string {
  return lookupSymbolName(symbol);
}

function computeValue(qty: string, price: string): string {
  const q = parseFloat(qty);
  const p = parseFloat(price);
  if (isNaN(q) || isNaN(p)) return '';
  return (q * p).toFixed(2);
}

interface AddAccountModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  connectedPlatforms: string[];
}

export default function AddAccountModal({ open, onClose, onSuccess, connectedPlatforms }: AddAccountModalProps) {
  const [screen, setScreen] = useState<Screen>('grid');
  const [selectedPlatformId, setSelectedPlatformId] = useState<string | null>(null);
  const [extractedPositions, setExtractedPositions] = useState<ExtractedPosition[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const [manualEntries, setManualEntries] = useState<ManualEntry[]>([{ ...EMPTY_MANUAL }]);
  const [, executeConfirmPositions] = useMutation(CONFIRM_POSITIONS_MUTATION);
  const [, executeParseScreenshot] = useMutation(PARSE_PORTFOLIO_SCREENSHOT_MUTATION);
  const [customPlatformName, setCustomPlatformName] = useState('');
  const [entryErrors, setEntryErrors] = useState<ManualEntryErrors[]>([]);

  const selectedPlatform = PLATFORMS.find((p) => p.id === selectedPlatformId);
  const isConnected = (id: string) => connectedPlatforms.includes(id);

  const resetState = () => {
    setScreen('grid');
    setSelectedPlatformId(null);
    setExtractedPositions([]);
    setUploading(false);
    setUploadError(undefined);
    setConfirming(false);
    setManualEntries([{ ...EMPTY_MANUAL }]);
    setCustomPlatformName('');
    setEntryErrors([]);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

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
            resolve(result.split(',')[1]);
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
            marketValue: p.marketValue,
          })),
        },
      });
      if (result.data?.confirmPositions) {
        resetState();
        onClose();
        onSuccess();
      } else {
        setUploadError(result.error?.message ?? 'Failed to save positions. Please try again.');
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to save positions.');
    } finally {
      setConfirming(false);
    }
  }, [selectedPlatformId, extractedPositions, executeConfirmPositions, onClose, onSuccess]);

  const handleBack = () => {
    if (screen === 'detail' || screen === 'custom') {
      setScreen('grid');
      setUploadError(undefined);
    } else if (screen === 'manual') {
      setScreen('detail');
      setUploadError(undefined);
    } else if (screen === 'verify') {
      setScreen(selectedPlatformId && !PLATFORMS.some((p) => p.id === selectedPlatformId) ? 'custom' : 'detail');
    }
  };

  const updateManualEntry = (idx: number, field: keyof ManualEntry, value: string) => {
    const sanitized = field === 'symbol' ? sanitizeSymbol(value) : field === 'name' ? value : sanitizeNumeric(value);

    setManualEntries((prev) =>
      prev.map((e, i) => {
        if (i !== idx) return e;
        const updated = { ...e, [field]: sanitized };
        if (field === 'symbol') {
          updated.name = lookupName(sanitized);
        }
        if (field === 'quantity' || field === 'marketPrice') {
          updated.marketValue = computeValue(
            field === 'quantity' ? sanitized : e.quantity,
            field === 'marketPrice' ? sanitized : e.marketPrice,
          );
        }
        return updated;
      }),
    );

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

  const addManualRow = () => setManualEntries((prev) => [...prev, { ...EMPTY_MANUAL }]);

  const removeManualRow = (idx: number) => {
    if (manualEntries.length <= 1) return;
    setManualEntries((prev) => prev.filter((_, i) => i !== idx));
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

  const platformTitle = (label: string) =>
    selectedPlatformId ? (
      <span className="flex items-center gap-2">
        <PlatformLogo platform={selectedPlatformId} size="sm" />
        {label}
      </span>
    ) : (
      label
    );

  const title =
    screen === 'grid'
      ? 'Add Account'
      : screen === 'detail'
        ? platformTitle(selectedPlatform?.name ?? 'Add Account')
        : screen === 'manual'
          ? platformTitle(`Add positions \u2014 ${selectedPlatform?.name}`)
          : screen === 'custom'
            ? 'Add custom platform'
            : platformTitle(`Verify positions \u2014 ${selectedPlatform?.name ?? customPlatformName.trim()}`);

  return (
    <Modal open={open} onClose={handleClose} title={title} maxWidth="max-w-2xl">
      {/* Platform Grid */}
      {screen === 'grid' && (
        <div>
          <p className="mb-5 text-sm text-text-secondary">
            Select a platform to add. You don&apos;t need to share credentials.
          </p>
          <div className="mb-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
            {PLATFORMS.map((platform) => (
              <PlatformTile
                key={platform.id}
                platform={platform}
                connected={isConnected(platform.id)}
                onClick={() => handlePlatformClick(platform.id)}
              />
            ))}
            <button
              type="button"
              onClick={handleCustomPlatformClick}
              className="group cursor-pointer flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border p-5 transition-all duration-200 hover:border-accent-primary/40 hover:bg-bg-hover/40"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-bg-tertiary transition-colors group-hover:bg-accent-primary/20">
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
              <span className="text-xs font-medium text-text-muted group-hover:text-accent-primary">Custom</span>
            </button>
          </div>
        </div>
      )}

      {/* Platform Detail — screenshot upload */}
      {screen === 'detail' && selectedPlatform && (
        <div>
          <ol className="mb-5 space-y-2">
            {selectedPlatform.instructions.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm text-text-secondary">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-bg-tertiary text-3xs font-medium text-text-muted">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
          <div className="mb-5">
            <DropZone onUpload={handleScreenshot} loading={uploading} error={uploadError} />
          </div>
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={handleBack}>
              Back
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setScreen('manual')}>
              Add manually
            </Button>
          </div>
        </div>
      )}

      {/* Manual Entry */}
      {screen === 'manual' && (
        <div>
          <p className="mb-4 text-sm text-text-secondary">Enter your holdings manually.</p>
          <div className="mb-5 space-y-3">
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
                    placeholder="Auto"
                    value={entry.name}
                    readOnly
                    size="sm"
                    className="flex-1 opacity-60"
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
                    placeholder="Auto"
                    value={entry.marketValue}
                    readOnly
                    size="sm"
                    className="w-24 opacity-60"
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
            <Button variant="ghost" size="sm" onClick={handleBack}>
              Back
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!manualEntries.some((e) => e.symbol.trim())}
              onClick={handleManualDone}
            >
              Review positions
            </Button>
          </div>
        </div>
      )}

      {/* Custom Platform Entry */}
      {screen === 'custom' && (
        <div>
          <p className="mb-4 text-sm text-text-secondary">Name your platform and enter your holdings.</p>
          <div className="mb-4">
            <Input
              label="Platform name"
              placeholder="e.g. eToro, Vanguard, My 401k"
              value={customPlatformName}
              onChange={(e) => setCustomPlatformName(sanitizePlatformName(e.target.value))}
              size="md"
            />
          </div>
          <p className="mb-2 text-sm font-medium text-text-secondary">Positions</p>
          <div className="mb-5 space-y-3">
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
                    placeholder="Auto"
                    value={entry.name}
                    readOnly
                    size="sm"
                    className="flex-1 opacity-60"
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
                    placeholder="Auto"
                    value={entry.marketValue}
                    readOnly
                    size="sm"
                    className="w-24 opacity-60"
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
            <Button variant="ghost" size="sm" onClick={handleBack}>
              Back
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!customPlatformName.trim() || !manualEntries.some((e) => e.symbol.trim())}
              onClick={handleCustomDone}
            >
              Review positions
            </Button>
          </div>
        </div>
      )}

      {/* Verify Positions */}
      {screen === 'verify' && (
        <div>
          <p className="mb-4 text-sm text-text-secondary">Review what Yojin extracted. Edit anything that looks off.</p>
          <div className="mb-5">
            <EditableTable positions={extractedPositions} onChange={setExtractedPositions} />
          </div>
          {uploadError && <p className="mb-3 text-xs font-medium text-error">{uploadError}</p>}
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={handleBack}>
              Back
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={confirming}
              disabled={extractedPositions.length === 0}
              onClick={handleConfirmPositions}
            >
              Confirm
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
