import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PositionInsight } from '../../api/types';
import { cn } from '../../lib/utils';
import { buildInsightSnippet, buildTelegramUrl, buildWhatsAppUrl } from '../../lib/share-insight';
import { renderNodeToPng } from '../../lib/share-image';
import { uploadShareImage } from '../../lib/share-upload';
import { ShareCard } from './share-card';

type Platform = 'telegram' | 'whatsapp';

interface ShareMenuProps {
  insight: PositionInsight;
  className?: string;
  /** Icon-only trigger for tight CTA rows. Defaults to showing the "Share" label. */
  compact?: boolean;
}

const PLATFORM_LABEL: Record<Platform, string> = {
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
};

const FILENAME_PREFIX = 'yojin-insight';

export function ShareMenu({ insight, className, compact = false }: ShareMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const toastTimerRef = useRef<number | null>(null);
  const uploadedUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const MENU_WIDTH = 240;
      const MENU_HEIGHT = 260;
      const margin = 8;
      let left = rect.right - MENU_WIDTH;
      let top = rect.bottom + 4;
      if (left < margin) left = margin;
      if (left + MENU_WIDTH > window.innerWidth - margin) left = window.innerWidth - MENU_WIDTH - margin;
      if (top + MENU_HEIGHT > window.innerHeight - margin) top = rect.top - MENU_HEIGHT - 4;
      setMenuPos({ top, left });
    };
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Cached upload is keyed per-insight; reset when any field the ShareCard
  // renders changes, otherwise a later platform click serves a stale image.
  const cacheKey = `${insight.symbol}|${insight.name}|${insight.rating}|${insight.conviction}|${insight.thesis}|${insight.opportunities.join('~')}|${insight.risks.join('~')}`;
  useEffect(() => {
    uploadedUrlRef.current = null;
  }, [cacheKey]);

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 4000);
  };

  async function renderImageBlob(): Promise<Blob> {
    setBusyLabel('Rendering image…');
    return renderNodeToPng(<ShareCard insight={insight} />);
  }

  async function getOrUploadImage(): Promise<string> {
    if (uploadedUrlRef.current) return uploadedUrlRef.current;
    const blob = await renderImageBlob();
    setBusyLabel('Uploading image…');
    const url = await uploadShareImage(blob, `${FILENAME_PREFIX}-${insight.symbol}.png`);
    uploadedUrlRef.current = url;
    return url;
  }

  const handlePlatform = async (platform: Platform) => {
    if (busy) return;
    setOpen(false);
    setBusy(true);
    try {
      const snippet = buildInsightSnippet(insight);

      if (platform === 'whatsapp') {
        // WhatsApp: share the full text content. Desktop browsers can't attach
        // an image to WhatsApp programmatically, and unfurling a catbox URL
        // duplicates the thesis/risks that are already in the image. So for
        // WhatsApp we skip the image entirely and just share the text.
        window.open(buildWhatsAppUrl(snippet.long), '_blank', 'noopener,noreferrer');
        showToast('Opened WhatsApp');
        return;
      }

      // Telegram: upload the card image and let the platform unfurl the URL
      // into an inline preview. Caption is minimal since the image carries the
      // thesis/opportunities/risks.
      const imageUrl = await getOrUploadImage();
      const url = buildTelegramUrl(snippet.caption, imageUrl);
      window.open(url, '_blank', 'noopener,noreferrer');
      showToast(`Opened ${PLATFORM_LABEL[platform]} — image will unfurl from the link`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to share');
    } finally {
      setBusy(false);
      setBusyLabel(null);
    }
  };

  const handleCopyLink = async () => {
    if (busy) return;
    setOpen(false);
    setBusy(true);
    try {
      const imageUrl = await getOrUploadImage();
      await navigator.clipboard.writeText(imageUrl);
      showToast('Image link copied to clipboard');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to copy link');
    } finally {
      setBusy(false);
      setBusyLabel(null);
    }
  };

  return (
    <div ref={rootRef} className={cn('relative inline-block', className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Share insight"
        aria-expanded={open}
        disabled={busy}
        className={cn(
          'inline-flex w-full items-center justify-center rounded-lg border border-border bg-bg-card text-xs font-medium text-text-primary hover:bg-bg-hover transition-colors cursor-pointer gap-1.5 px-2.5 py-1.5 h-7 disabled:cursor-not-allowed disabled:opacity-40',
        )}
      >
        <ShareIcon className="h-3.5 w-3.5" />
        {compact ? <span className="sr-only">Share</span> : busy && busyLabel ? busyLabel : 'Share'}
      </button>

      {open &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: 240 }}
            className="z-[1000] rounded-lg border border-border bg-bg-card shadow-lg py-1"
          >
            <MenuItem
              label="Telegram"
              icon={<TelegramIcon />}
              disabled={busy}
              onClick={() => handlePlatform('telegram')}
            />
            <MenuItem
              label="WhatsApp"
              icon={<WhatsAppIcon />}
              disabled={busy}
              onClick={() => handlePlatform('whatsapp')}
            />
            <div className="my-1 h-px bg-border" />
            <MenuItem label="Copy image link" icon={<LinkIcon />} disabled={busy} onClick={handleCopyLink} />
            <div className="px-3 pb-2 pt-1 text-[10px] leading-tight text-text-muted">
              Image is uploaded to catbox.moe (public host) so it appears in the chat as a preview.
            </div>
          </div>,
          document.body,
        )}

      {busy &&
        createPortal(
          <div
            role="dialog"
            aria-live="polite"
            aria-label="Preparing share image"
            className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          >
            <div className="flex min-w-[280px] flex-col items-center gap-4 rounded-xl border border-border bg-bg-card px-8 py-6 shadow-xl">
              <Spinner />
              <div className="flex flex-col items-center gap-1">
                <div className="text-sm font-medium text-text-primary">{busyLabel ?? 'Preparing share image…'}</div>
                <div className="text-xs text-text-muted">This usually takes a few seconds.</div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {toast &&
        createPortal(
          <div className="fixed bottom-6 right-6 z-[1000] max-w-sm rounded-lg border border-border bg-bg-card px-4 py-2.5 text-xs text-text-primary shadow-lg">
            {toast}
          </div>,
          document.body,
        )}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="h-8 w-8 animate-spin text-accent-primary" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function MenuItem({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-text-primary hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
    >
      <span className="h-4 w-4 flex items-center justify-center text-text-secondary">{icon}</span>
      {label}
    </button>
  );
}

function ShareIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z"
      />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="#229ED9">
      <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="#25D366">
      <path d="M17.47 14.38c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.14-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51l-.57-.01c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.06 2.88 1.21 3.08.15.2 2.09 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.08 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.12-.27-.2-.57-.35zM12 2a10 10 0 0 0-8.64 15.03L2 22l5.13-1.34A10 10 0 1 0 12 2zm5.88 14.54c-.25.7-1.47 1.34-2.05 1.43-.52.08-1.18.12-1.9-.12a19.88 19.88 0 0 1-1.72-.64c-3.04-1.31-5.02-4.36-5.17-4.56-.15-.2-1.22-1.62-1.22-3.09 0-1.47.77-2.2 1.05-2.5.28-.3.6-.37.8-.37h.58c.19 0 .44-.07.69.52.25.6.85 2.07.92 2.22.08.15.12.33.02.53-.1.2-.15.32-.3.5l-.45.52c-.15.15-.3.31-.13.61.17.3.77 1.28 1.66 2.07 1.15 1.02 2.11 1.34 2.41 1.49.3.15.48.12.66-.07.17-.2.74-.87.94-1.17.2-.3.4-.25.67-.15.27.1 1.74.82 2.04.97.3.15.5.22.57.35.07.12.07.72-.18 1.42z" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
      />
    </svg>
  );
}
