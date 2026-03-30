import { useState } from 'react';

import { useConnectChannel, useValidateChannelToken } from '../../api/hooks/use-channels';
import Button from '../common/button';
import Modal from '../common/modal';
import { getChannelMeta } from './channel-meta';

interface ConnectChannelModalProps {
  open: boolean;
  channelId: string | null;
  onClose: () => void;
  onConnected: () => void;
}

export function ConnectChannelModal({ open, channelId, onClose, onConnected }: ConnectChannelModalProps) {
  const meta = channelId ? getChannelMeta(channelId) : null;
  const fields = meta?.credentialFields ?? [];

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
    if (!channelId) return;
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
    if (!channelId) return;
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

  const handleClose = () => {
    setValues({});
    setError(null);
    setValidated(false);
    onClose();
  };

  const allFieldsFilled = fields.every((f) => values[f.key]?.trim());

  return (
    <Modal open={open} onClose={handleClose} title={`Connect ${meta?.label ?? 'Channel'}`}>
      {meta?.setupInstructions && <p className="text-sm text-text-secondary mb-4">{meta.setupInstructions}</p>}

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
        <Button variant="secondary" size="sm" onClick={handleClose}>
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
    </Modal>
  );
}
