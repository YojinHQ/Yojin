import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import type { ChatImageData } from '../../lib/chat-context';

export interface ImageAttachment extends ChatImageData {
  preview: string;
  name: string;
}

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAX_SIZE_MB = 10;
const MAX_ROWS = 6;
const LINE_HEIGHT = 20;
const PADDING_Y = 16;

export interface ChatInputProps {
  onSend: (message: string, image?: ImageAttachment) => void;
  disabled?: boolean;
  disableAttachment?: boolean;
  placeholder?: string;
  initialValue?: string;
  /** Text to pre-fill in the input. Pair with prefillKey to trigger updates. */
  prefillValue?: string;
  /** Increment to trigger a new prefill. */
  prefillKey?: number;
  /** Whether the planner panel is currently open. */
  plannerOpen?: boolean;
  /** Toggle the planner panel. When provided, the send button becomes a planner toggle when input is empty. */
  onTogglePlanner?: () => void;
}

export default function ChatInput({
  onSend,
  disabled,
  disableAttachment,
  placeholder = 'How can I help you today?',
  initialValue,
  prefillValue,
  prefillKey,
  plannerOpen,
  onTogglePlanner,
}: ChatInputProps) {
  const [value, setValue] = useState(initialValue ?? '');
  const [image, setImage] = useState<ImageAttachment | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prefillTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefillRafRef = useRef<number | null>(null);

  // Pre-fill the input when prefillKey changes (template selection)
  useEffect(() => {
    if (prefillKey !== undefined && prefillKey > 0 && prefillValue !== undefined) {
      // Capture prefillValue so the closure isn't affected by later prop changes
      const captured = prefillValue;
      // Defer setState to avoid synchronous setState-in-effect lint rule
      prefillTimeoutRef.current = setTimeout(() => {
        setValue(captured);
        // Select the [TICKER] placeholder if present so the user can type over it
        prefillRafRef.current = requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (!el) return;
          el.focus();
          const start = captured.indexOf('[');
          const end = captured.indexOf(']');
          if (start !== -1 && end !== -1) {
            el.setSelectionRange(start, end + 1);
          }
        });
      }, 0);
    }
    return () => {
      if (prefillTimeoutRef.current !== null) {
        clearTimeout(prefillTimeoutRef.current);
        prefillTimeoutRef.current = null;
      }
      if (prefillRafRef.current !== null) {
        cancelAnimationFrame(prefillRafRef.current);
        prefillRafRef.current = null;
      }
    };
  }, [prefillKey]); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally keyed on prefillKey only

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = LINE_HEIGHT * MAX_ROWS + PADDING_Y;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [value, resize]);

  // Refocus the textarea when the AI finishes responding.
  // Strategy Studio uses `disabled={isLoading}`, main chat uses `disableAttachment={isLoading}`.
  const prevDisabledRef = useRef(disabled);
  const prevDisableAttachmentRef = useRef(disableAttachment);
  useEffect(() => {
    const disabledCleared = prevDisabledRef.current && !disabled;
    const attachmentCleared = prevDisableAttachmentRef.current && !disableAttachment;
    if (disabledCleared || attachmentCleared) {
      textareaRef.current?.focus();
    }
    prevDisabledRef.current = disabled;
    prevDisableAttachmentRef.current = disableAttachment;
  }, [disabled, disableAttachment]);

  // When attachment is disabled, treat any pre-attached image as absent.
  // This prevents silently sending an image that gets dropped in the queued path.
  const effectiveImage = disableAttachment ? null : image;

  /** Shared logic: validate a File and read it as an ImageAttachment. */
  const processFile = useCallback((file: File) => {
    if (!ACCEPTED_TYPES.has(file.type)) {
      alert(`Unsupported file type: ${file.type}. Accepted: JPEG, PNG, GIF, WebP.`);
      return;
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      alert(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum size is ${MAX_SIZE_MB} MB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      setImage({
        base64,
        mediaType: file.type as ImageAttachment['mediaType'],
        preview: dataUrl,
        name: file.name,
      });
    };
    reader.onerror = () => {
      alert('Failed to read the image file. Please try again.');
    };
    reader.readAsDataURL(file);
  }, []);

  const submit = () => {
    if ((!value.trim() && !effectiveImage) || disabled) return;
    onSend(value.trim() || (effectiveImage ? 'Analyze this image.' : ''), effectiveImage ?? undefined);
    setValue('');
    setImage(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (disableAttachment) return;
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    if (disableAttachment) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) processFile(file);
        return;
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div onDrop={handleDrop} onDragOver={handleDragOver} onPaste={handlePaste}>
      {effectiveImage && (
        <div className="mb-1 flex">
          <div className="group inline-flex items-center rounded-full border border-border-light bg-bg-secondary transition-colors hover:border-text-muted">
            <button
              type="button"
              onClick={() => setShowPreview(true)}
              className="inline-flex items-center gap-1.5 py-1 pl-1 pr-1.5"
              aria-label="Preview attached image"
            >
              <img
                src={effectiveImage.preview}
                alt={effectiveImage.name}
                className="h-5 w-5 rounded-full object-cover"
              />
              <span className="max-w-[100px] truncate text-2xs text-text-secondary group-hover:text-text-primary">
                {effectiveImage.name}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setImage(null)}
              className="mr-0.5 flex h-6 w-6 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
              aria-label="Remove image"
            >
              <span className="text-base leading-none">&times;</span>
            </button>
          </div>
        </div>
      )}

      {effectiveImage && showPreview && (
        <div
          role="dialog"
          tabIndex={-1}
          ref={(el) => el?.focus()}
          className="fixed inset-0 z-50 flex items-center justify-center outline-none"
          onClick={() => setShowPreview(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setShowPreview(false);
          }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative max-h-[80vh] max-w-[80vw]" onClick={(e) => e.stopPropagation()}>
            <img
              src={effectiveImage.preview}
              alt={effectiveImage.name}
              className="max-h-[80vh] max-w-[80vw] rounded-lg object-contain"
            />
            <button
              type="button"
              onClick={() => setShowPreview(false)}
              className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-bg-secondary text-text-muted shadow-lg transition-colors hover:text-text-primary"
              aria-label="Close preview"
            >
              &times;
            </button>
          </div>
        </div>
      )}

      <div className="flex min-h-[80px] items-center gap-2 rounded-2xl border border-border-light bg-bg-secondary px-5 py-3">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={effectiveImage ? 'Add a message or send the image...' : placeholder}
          rows={1}
          disabled={disabled}
          className="flex-1 resize-none bg-transparent py-1.5 text-base leading-6 text-text-primary outline-none placeholder:text-text-muted"
        />

        {/* Send button when there's content, planner toggle when empty */}
        {value.trim() || effectiveImage ? (
          <button
            type="button"
            onClick={submit}
            disabled={disabled}
            className={cn(
              'mb-px flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg transition-colors',
              !disabled
                ? 'cursor-pointer bg-accent-primary text-white hover:bg-accent-secondary'
                : 'cursor-default bg-bg-tertiary text-text-muted',
            )}
            aria-label="Send message"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            onClick={onTogglePlanner}
            disabled={!onTogglePlanner}
            className={cn(
              'mb-px flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg transition-colors',
              onTogglePlanner
                ? 'cursor-pointer bg-success/30 text-white hover:bg-success/40'
                : 'cursor-default bg-bg-tertiary text-text-muted/40',
            )}
            aria-label={plannerOpen ? 'Hide prompt templates' : 'Show prompt templates'}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={cn('transition-transform duration-200', plannerOpen && 'rotate-180')}
            >
              <path d="M18 15l-6-6-6 6" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
