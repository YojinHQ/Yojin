import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

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
import type { ChannelMeta } from './channel-meta.js';
import { getChannelMeta } from './channel-meta.js';

const QR_TIMEOUT_SEC = 120;

/** Renders setup instructions, replacing the first occurrence of setupLink.text with a clickable link. */
function SetupInstructions({ meta }: { meta: ChannelMeta }): ReactNode {
  if (!meta.setupInstructions) return null;

  if (!meta.setupLink) {
    return <p className="text-sm text-text-secondary mb-5">{meta.setupInstructions}</p>;
  }

  const idx = meta.setupInstructions.indexOf(meta.setupLink.text);
  if (idx === -1) {
    return <p className="text-sm text-text-secondary mb-5">{meta.setupInstructions}</p>;
  }

  const before = meta.setupInstructions.slice(0, idx);
  const after = meta.setupInstructions.slice(idx + meta.setupLink.text.length);

  return (
    <p className="text-sm text-text-secondary mb-5">
      {before}
      <a href={meta.setupLink.url} target="_blank" rel="noopener noreferrer" className="text-accent-primary underline">
        {meta.setupLink.text}
      </a>
      {after}
    </p>
  );
}

interface ConnectChannelModalProps {
  open: boolean;
  channelId: string | null;
  onClose: () => void;
  onConnected: () => void;
}

interface QrPairingFlowProps {
  channelId: string;
  channelLabel: string;
  meta: ChannelMeta;
  onConnected: () => void;
  onClose: () => void;
}

function QrPairingFlow({ channelId, channelLabel, meta, onConnected, onClose }: QrPairingFlowProps) {
  const [qrData, setQrData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [initiated, setInitiated] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(QR_TIMEOUT_SEC);
  const [expired, setExpired] = useState(false);
  const countdownRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const qrDataTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const startPairingTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [, initiatePairing] = useInitiateChannelPairing();
  const [, cancelPairing] = useCancelChannelPairing();
  const [pairingResult] = useChannelPairing(initiated ? channelId : null);

  const startCountdown = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setSecondsLeft(QR_TIMEOUT_SEC);
    setExpired(false);
    countdownRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(countdownRef.current);
          setExpired(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const startPairing = useCallback(async () => {
    setError(null);
    setQrData(null);
    setExpired(false);
    setConnected(false);

    const result = await initiatePairing({ id: channelId });

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
    startCountdown();
  }, [channelId, initiatePairing, startCountdown]);

  // Kick off pairing on mount, cancel on unmount
  useEffect(() => {
    // Defer the setState-heavy startPairing call out of the effect body so it doesn't run
    // synchronously during render (react-hooks/set-state-in-effect).
    startPairingTimeoutRef.current = setTimeout(() => {
      void startPairing();
    }, 0);

    return () => {
      if (startPairingTimeoutRef.current) clearTimeout(startPairingTimeoutRef.current);
      if (qrDataTimeoutRef.current) clearTimeout(qrDataTimeoutRef.current);
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      void cancelPairing({ id: channelId });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  // Handle subscription events
  useEffect(() => {
    const event = pairingResult.data?.onChannelPairing;
    if (!event) return;

    if (event.qrData) {
      const nextQrData = event.qrData;
      if (qrDataTimeoutRef.current) clearTimeout(qrDataTimeoutRef.current);
      qrDataTimeoutRef.current = setTimeout(() => {
        setQrData(nextQrData);
      }, 0);
    }

    if (event.status === 'CONNECTED') {
      if (countdownRef.current) clearInterval(countdownRef.current);
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
      statusTimeoutRef.current = setTimeout(() => {
        setConnected(true);
      }, 0);
      const timer = setTimeout(() => {
        onConnected();
      }, 1500);
      return () => clearTimeout(timer);
    }

    if (event.status === 'FAILED' || event.status === 'EXPIRED') {
      if (countdownRef.current) clearInterval(countdownRef.current);
      const nextError = event.error ?? (event.status === 'EXPIRED' ? 'QR code expired.' : 'Pairing failed');
      if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
      statusTimeoutRef.current = setTimeout(() => {
        setExpired(true);
        setError(nextError);
      }, 0);
    }
  }, [pairingResult.data, onConnected]);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <>
      <SetupInstructions meta={meta} />

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
        ) : qrData && !expired ? (
          <div className="flex flex-col items-center gap-3">
            <div className="rounded-xl bg-white p-4">
              <QRCodeSVG value={qrData} size={200} level="M" />
            </div>
            <p className="text-xs text-text-muted tabular-nums">Expires in {formatTime(secondsLeft)}</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <p className="text-sm text-error text-center">{error}</p>
            <Button variant="primary" size="sm" onClick={() => void startPairing()}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-8">
            <Spinner size="lg" />
            <p className="text-sm text-text-muted">Generating QR code…</p>
          </div>
        )}
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

function isRateLimited(errorMsg: string | null): boolean {
  return !!errorMsg?.startsWith('Too many attempts');
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
    if (!isRateLimited(error)) {
      setError(null);
    }
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
      <SetupInstructions meta={meta} />

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

      {error && isRateLimited(error) ? (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 mb-4">
          <p className="text-sm text-warning">{error}</p>
        </div>
      ) : error ? (
        <p className="text-sm text-error mb-4">{error}</p>
      ) : null}

      {validated && <p className="text-sm text-success mb-4">Token validated successfully</p>}

      <div className="flex justify-end gap-3">
        <Button variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
        {!validated ? (
          <Button
            variant="primary"
            size="sm"
            loading={validating}
            disabled={!allFieldsFilled || isRateLimited(error)}
            onClick={handleValidate}
          >
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
          meta={meta}
          onConnected={onConnected}
          onClose={handleClose}
        />
      ) : channelId ? (
        <TokenFlow channelId={channelId} onConnected={onConnected} onClose={handleClose} />
      ) : null}
    </Modal>
  );
}
