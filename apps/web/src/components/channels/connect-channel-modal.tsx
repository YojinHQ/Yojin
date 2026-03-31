import { useEffect, useState } from 'react';

import { QRCodeSVG } from 'qrcode.react';

import {
  useCancelChannelPairing,
  useChannelPairing,
  useConnectChannel,
  useInitiateChannelPairing,
  useValidateChannelToken,
} from '../../api/hooks/use-channels.js';
import Spinner from '../common/spinner.js';
import Button from '../common/button.js';
import Modal from '../common/modal.js';
import { getChannelMeta } from './channel-meta.js';

interface ConnectChannelModalProps {
  open: boolean;
  channelId: string | null;
  onClose: () => void;
  onConnected: () => void;
}

interface QrPairingFlowProps {
  channelId: string;
  channelLabel: string;
  setupInstructions: string;
  onConnected: () => void;
  onClose: () => void;
}

function QrPairingFlow({ channelId, channelLabel, setupInstructions, onConnected, onClose }: QrPairingFlowProps) {
  const [qrData, setQrData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [initiated, setInitiated] = useState(false);

  const [, initiatePairing] = useInitiateChannelPairing();
  const [, cancelPairing] = useCancelChannelPairing();
  const [pairingResult] = useChannelPairing(initiated ? channelId : null);

  // Kick off pairing on mount, cancel on unmount
  useEffect(() => {
    let cancelled = false;

    async function start() {
      const result = await initiatePairing({ id: channelId });

      if (cancelled) return;

      if (result.error) {
        setError(result.error.message || 'Failed to start pairing');
        return;
      }

      if (!result.data?.initiateChannelPairing.success) {
        setError(result.data?.initiateChannelPairing.error ?? 'Failed to start pairing');
        return;
      }

      if (result.data.initiateChannelPairing.qrData) {
        setQrData(result.data.initiateChannelPairing.qrData);
      }

      setInitiated(true);
    }

    void start();

    return () => {
      cancelled = true;
      void cancelPairing({ id: channelId });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  // Handle subscription events
  useEffect(() => {
    const event = pairingResult.data?.onChannelPairing;
    if (!event) return;

    if (event.qrData) {
      setQrData(event.qrData);
    }

    if (event.status === 'CONNECTED') {
      setConnected(true);
      const timer = setTimeout(() => {
        onConnected();
      }, 1500);
      return () => clearTimeout(timer);
    }

    if (event.status === 'FAILED' || event.status === 'EXPIRED') {
      setError(event.error ?? (event.status === 'EXPIRED' ? 'QR code expired. Please try again.' : 'Pairing failed'));
    }
  }, [pairingResult.data, onConnected]);

  return (
    <>
      {setupInstructions && <p className="text-sm text-text-secondary mb-5">{setupInstructions}</p>}

      <div className="flex flex-col items-center justify-center gap-4 py-2 mb-6">
        {connected ? (
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/20">
              <svg
                className="h-8 w-8 text-success"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm font-medium text-success">Connected to {channelLabel}</p>
          </div>
        ) : qrData ? (
          <div className="rounded-xl bg-white p-4">
            <QRCodeSVG value={qrData} size={200} level="M" />
          </div>
        ) : error ? null : (
          <div className="flex flex-col items-center gap-3 py-8">
            <Spinner size="lg" />
            <p className="text-sm text-text-muted">Generating QR code…</p>
          </div>
        )}

        {error && <p className="text-sm text-error text-center">{error}</p>}
      </div>

      <div className="flex justify-end gap-3">
        <Button variant="secondary" size="sm" onClick={onClose}>
          {connected ? 'Done' : 'Cancel'}
        </Button>
      </div>
    </>
  );
}

interface TokenFlowProps {
  channelId: string;
  onConnected: () => void;
  onClose: () => void;
}

function TokenFlow({ channelId, onConnected, onClose }: TokenFlowProps) {
  const meta = getChannelMeta(channelId);
  const fields = meta.credentialFields;

  const [values, setValues] = useState<Record<string, string>>({});
  const [validating, setValidating] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validated, setValidated] = useState(false);

  const [, validateToken] = useValidateChannelToken();
  const [, connectChannel] = useConnectChannel();

  const handleFieldChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setError(null);
    setValidated(false);
  };

  const handleValidate = async () => {
    setValidating(true);
    setError(null);

    const credentials = Object.entries(values).map(([key, value]) => ({ key, value }));
    const result = await validateToken({ id: channelId, credentials });

    if (result.error) {
      setError(result.error.message || 'Validation failed');
      setValidating(false);
      return;
    }

    if (!result.data?.validateChannelToken.success) {
      setError(result.data?.validateChannelToken.error ?? 'Invalid credentials');
      setValidating(false);
      return;
    }

    setValidated(true);
    setValidating(false);
  };

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);

    const credentials = Object.entries(values).map(([key, value]) => ({ key, value }));
    const result = await connectChannel({ id: channelId, credentials });

    if (result.error) {
      setError(result.error.message || 'Connection failed');
      setConnecting(false);
      return;
    }

    if (!result.data?.connectChannel.success) {
      setError(result.data?.connectChannel.error ?? 'Connection failed');
      setConnecting(false);
      return;
    }

    setConnecting(false);
    setValues({});
    setValidated(false);
    onConnected();
  };

  const allFieldsFilled = fields.every((f) => values[f.key]?.trim());

  return (
    <>
      {meta.setupInstructions && <p className="text-sm text-text-secondary mb-4">{meta.setupInstructions}</p>}

      <div className="space-y-4 mb-6">
        {fields.map((field) => (
          <div key={field.key}>
            <label className="block text-sm font-medium text-text-secondary mb-1">{field.label}</label>
            <input
              type="password"
              value={values[field.key] ?? ''}
              onChange={(e) => handleFieldChange(field.key, e.target.value)}
              placeholder={field.placeholder}
              className="w-full rounded-lg border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
            />
            {field.helpText && <p className="mt-1 text-xs text-text-muted">{field.helpText}</p>}
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-error mb-4">{error}</p>}

      {validated && <p className="text-sm text-success mb-4">Token validated successfully</p>}

      <div className="flex justify-end gap-3">
        <Button variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
        {!validated ? (
          <Button variant="primary" size="sm" loading={validating} disabled={!allFieldsFilled} onClick={handleValidate}>
            Validate
          </Button>
        ) : (
          <Button variant="primary" size="sm" loading={connecting} onClick={handleConnect}>
            Connect
          </Button>
        )}
      </div>
    </>
  );
}

export function ConnectChannelModal({ open, channelId, onClose, onConnected }: ConnectChannelModalProps) {
  const meta = channelId ? getChannelMeta(channelId) : null;

  const handleClose = () => {
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title={`Connect ${meta?.label ?? 'Channel'}`}>
      {channelId && meta?.connectionType === 'qr' ? (
        <QrPairingFlow
          channelId={channelId}
          channelLabel={meta.label}
          setupInstructions={meta.setupInstructions}
          onConnected={onConnected}
          onClose={handleClose}
        />
      ) : channelId ? (
        <TokenFlow channelId={channelId} onConnected={onConnected} onClose={handleClose} />
      ) : null}
    </Modal>
  );
}
