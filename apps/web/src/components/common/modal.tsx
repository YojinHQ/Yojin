import { useEffect } from 'react';
import { cn } from '../../lib/utils';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: string;
  /** Override the dialog container classes (merged via cn) */
  className?: string;
  /** Override the fixed outer wrapper classes (e.g. centering offset) */
  wrapperClassName?: string;
  /** ID of an element that labels the dialog (alternative to title for accessible name) */
  'aria-labelledby'?: string;
}

export default function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = 'max-w-lg',
  className,
  wrapperClassName,
  'aria-labelledby': ariaLabelledBy,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={cn('fixed inset-0 z-50 flex items-center justify-center', wrapperClassName)}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={!ariaLabelledBy && typeof title === 'string' ? title : undefined}
        aria-labelledby={ariaLabelledBy}
        className={cn(
          'relative w-full max-h-[80vh] overflow-auto rounded-2xl border border-border bg-bg-secondary p-6',
          maxWidth,
          className,
        )}
      >
        {title && (
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-headline text-lg text-text-primary">{title}</h2>
            <button
              onClick={onClose}
              className="cursor-pointer text-text-muted transition-colors hover:text-text-primary"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export type { ModalProps };
