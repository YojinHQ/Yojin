import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';

export interface ChatInputProps {
  onSend: (message: string) => void;
  onAttach?: () => void;
  disabled?: boolean;
  placeholder?: string;
  initialValue?: string;
}

const MAX_ROWS = 6;
const LINE_HEIGHT = 20;
const PADDING_Y = 16;

export default function ChatInput({
  onSend,
  onAttach,
  disabled,
  placeholder = 'How can I help you today?',
  initialValue,
}: ChatInputProps) {
  const [value, setValue] = useState(initialValue ?? '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const submit = () => {
    if (!value.trim() || disabled) return;
    onSend(value.trim());
    setValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex items-end gap-2 rounded-2xl border border-border-light bg-bg-secondary px-3 py-2">
      <button
        type="button"
        onClick={onAttach}
        disabled={disabled || !onAttach}
        aria-label="Attach file"
        className={cn(
          'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-colors mb-px',
          onAttach && !disabled
            ? 'text-text-muted hover:text-text-secondary hover:bg-bg-hover cursor-pointer'
            : 'text-text-muted/40 cursor-default',
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
        placeholder={placeholder}
        rows={1}
        disabled={disabled}
        className="flex-1 resize-none bg-transparent text-sm leading-5 text-text-primary outline-none placeholder:text-text-muted py-1.5"
      />

      <button
        type="button"
        onClick={submit}
        disabled={!value.trim() || disabled}
        className={cn(
          'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-colors mb-px',
          value.trim() && !disabled
            ? 'bg-accent-primary text-white hover:bg-accent-secondary cursor-pointer'
            : 'bg-bg-tertiary text-text-muted cursor-default',
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
  );
}
