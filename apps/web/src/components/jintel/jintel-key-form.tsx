import { useState, useCallback } from 'react';
import { useMutation } from 'urql';
import Button from '../common/button';
import { VALIDATE_JINTEL_KEY_MUTATION } from '../../api/documents';
import type { ValidateJintelKeyMutationResult } from '../../api/types';
import { cn } from '../../lib/utils';

interface JintelKeyFormProps {
  onSuccess?: () => void;
  className?: string;
}

export function JintelKeyForm({ onSuccess, className }: JintelKeyFormProps) {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [{ fetching }, validateKey] = useMutation<ValidateJintelKeyMutationResult>(VALIDATE_JINTEL_KEY_MUTATION);

  const handleValidate = useCallback(async () => {
    if (!apiKey.trim()) {
      setError('API key cannot be empty.');
      return;
    }

    setError(null);
    setSuccess(false);

    const result = await validateKey({ apiKey: apiKey.trim() });

    if (result.data?.validateJintelKey.success) {
      setSuccess(true);
      setError(null);
      onSuccess?.();
    } else {
      setError(result.data?.validateJintelKey.error ?? result.error?.message ?? 'Validation failed.');
    }
  }, [apiKey, validateKey, onSuccess]);

  if (success) {
    return (
      <div className={cn('flex items-center gap-2 text-success', className)}>
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        <span className="text-sm font-medium">Connected</span>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center gap-2">
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Jintel API key"
            autoComplete="off"
            className="w-48 rounded-lg border border-border bg-bg-tertiary px-3 py-1.5 pr-8 text-xs text-text-primary placeholder:text-text-muted outline-none transition-colors focus-visible:border-accent-primary focus-visible:ring-2 focus-visible:ring-accent-primary/30"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleValidate();
            }}
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              {showKey ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
                />
              ) : (
                <>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
                  />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </>
              )}
            </svg>
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-px">
            {[0, 1, 2].map((i) => (
              <svg
                key={i}
                className="h-2.5 w-1.5 text-accent-primary"
                style={{ animation: `chevron-flow 2s ease-in-out ${i * 0.25}s infinite` }}
                viewBox="0 0 6 10"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M1 1l4 4-4 4" />
              </svg>
            ))}
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={handleValidate}
            disabled={fetching || !apiKey.trim()}
            className="[animation:glow-breathe_3s_ease-in-out_infinite]"
          >
            {fetching ? 'Validating...' : 'Validate'}
          </Button>
        </div>
      </div>
      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}
