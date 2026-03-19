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
  placeholder?: string;
  initialValue?: string;
}

export default function ChatInput({
  onSend,
  disabled,
  placeholder = 'How can I help you today?',
  initialValue,
}: ChatInputProps) {
  const [value, setValue] = useState(initialValue ?? '');
  const [image, setImage] = useState<ImageAttachment | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    if ((!value.trim() && !image) || disabled) return;
    onSend(value.trim() || (image ? 'Analyze this image.' : ''), image ?? undefined);
    setValue('');
    setImage(null);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    // Reset input so the same file can be re-selected
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
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
      {image && (
        <div className="mb-2 flex items-center gap-3 rounded-lg border border-border-light bg-bg-secondary px-3 py-2">
          <img src={image.preview} alt={image.name} className="h-12 w-12 rounded object-cover" />
          <span className="flex-1 truncate text-xs text-text-secondary">{image.name}</span>
          <button
            type="button"
            onClick={() => setImage(null)}
            className="text-sm text-text-muted hover:text-text-primary"
            aria-label="Remove image"
          >
            &times;
          </button>
        </div>
      )}

      <div className="flex items-end gap-2 rounded-2xl border border-border-light bg-bg-secondary px-3 py-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          onChange={handleFileSelect}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          aria-label="Attach file"
          className={cn(
            'mb-px flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-colors',
            !disabled
              ? 'cursor-pointer text-text-muted hover:bg-bg-hover hover:text-text-secondary'
              : 'cursor-default text-text-muted/40',
          )}
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
          >
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
          </svg>
        </button>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={image ? 'Add a message or send the image...' : placeholder}
          rows={1}
          disabled={disabled}
          className="flex-1 resize-none bg-transparent py-1.5 text-sm leading-5 text-text-primary outline-none placeholder:text-text-muted"
        />

        <button
          type="button"
          onClick={submit}
          disabled={(!value.trim() && !image) || disabled}
          className={cn(
            'mb-px flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-colors',
            (value.trim() || image) && !disabled
              ? 'cursor-pointer bg-accent-primary text-white hover:bg-accent-secondary'
              : 'cursor-default bg-bg-tertiary text-text-muted',
          )}
        >
          <svg
            width="18"
            height="18"
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
      </div>
    </div>
  );
}
