import { useState, useRef, useCallback } from 'react';
import { cn } from '../../lib/utils';
import Spinner from '../common/spinner';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

interface DropZoneProps {
  onUpload: (file: File) => void;
  loading: boolean;
  error?: string;
  className?: string;
}

export function DropZone({ onUpload, loading, error, className }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [localError, setLocalError] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);

  const displayError = error || localError;

  const validateAndUpload = useCallback(
    (file: File) => {
      setLocalError(undefined);
      if (!ACCEPTED_TYPES.includes(file.type)) {
        setLocalError('Please upload a PNG, JPEG, or WebP image');
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        setLocalError('Image must be under 10 MB');
        return;
      }
      onUpload(file);
    },
    [onUpload],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) validateAndUpload(file);
    },
    [validateAndUpload],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) validateAndUpload(file);
      // Reset so the same file can be selected again
      e.target.value = '';
    },
    [validateAndUpload],
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => !loading && inputRef.current?.click()}
      className={cn(
        'group relative cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-all duration-200',
        isDragging
          ? 'border-accent-primary bg-accent-glow/30'
          : displayError
            ? 'border-error/40 bg-error/[0.03]'
            : 'border-border bg-bg-card/50 hover:border-border-light hover:bg-bg-hover/30',
        loading && 'pointer-events-none',
        className,
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        className="hidden"
        onChange={handleFileChange}
      />

      {loading ? (
        <div className="flex flex-col items-center gap-3">
          <Spinner size="lg" />
          <p className="text-sm text-text-secondary">Analyzing screenshot...</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div
            className={cn(
              'flex h-12 w-12 items-center justify-center rounded-xl transition-colors',
              isDragging
                ? 'bg-accent-primary/20 text-accent-primary'
                : 'bg-bg-tertiary text-text-muted group-hover:text-text-secondary',
            )}
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
              />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-text-primary">
              {isDragging ? 'Drop your screenshot here' : 'Drop screenshot here'}
            </p>
            <p className="mt-1 text-xs text-text-muted">or click to upload (PNG, JPEG, WebP — max 10 MB)</p>
          </div>
          {displayError && <p className="text-xs font-medium text-error">{displayError}</p>}
        </div>
      )}
    </div>
  );
}
