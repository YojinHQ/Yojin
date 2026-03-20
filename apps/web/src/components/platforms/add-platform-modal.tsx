import { useNavigate } from 'react-router';

import type { Platform } from '../../api/types';
import { KNOWN_PLATFORMS } from '../../api/types';
import Badge from '../common/badge';
import Button from '../common/button';
import Modal from '../common/modal';
import { PlatformLogo } from './platform-logos';

interface AddPlatformModalProps {
  open: boolean;
  onClose: () => void;
  /** Platforms already connected — hidden from the selector. */
  connectedPlatforms: readonly Platform[];
}

/** Platforms shown in the modal (exclude MANUAL). */
const DISPLAY_PLATFORMS = KNOWN_PLATFORMS.filter((p) => p !== 'MANUAL');

export function AddPlatformModal({ open, onClose, connectedPlatforms }: AddPlatformModalProps) {
  const navigate = useNavigate();

  const available = DISPLAY_PLATFORMS.filter((p) => !connectedPlatforms.includes(p));

  function handleGoToChat() {
    onClose();
    navigate('/chat');
  }

  return (
    <Modal open={open} onClose={onClose} title="Import Positions" maxWidth="max-w-sm">
      <div className="space-y-5">
        {/* Primary action — screenshot import */}
        <div className="rounded-xl border border-border bg-bg-tertiary/20 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <svg
              className="h-5 w-5 text-accent-primary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z"
              />
            </svg>
            <span className="text-sm font-medium text-text-primary">Screenshot Import</span>
          </div>
          <p className="text-xs text-text-muted leading-relaxed">
            Paste a screenshot of your portfolio in the chat. Yojin&apos;s AI will extract your positions automatically
            — works with any platform.
          </p>
          <Button size="sm" onClick={handleGoToChat} className="w-full">
            Open Chat
          </Button>
        </div>

        {/* Supported platforms row */}
        {available.length > 0 && (
          <div className="space-y-2">
            <p className="text-2xs text-text-muted uppercase tracking-wider">Supported platforms</p>
            <div className="flex flex-wrap gap-2">
              {available.map((platform) => (
                <PlatformLogo key={platform} platform={platform} size="sm" />
              ))}
            </div>
          </div>
        )}

        {/* Coming soon hint */}
        <div className="flex items-center gap-2 pt-1">
          <Badge variant="neutral" size="xs">
            Coming Soon
          </Badge>
          <span className="text-2xs text-text-muted">Direct API connections &amp; auto-sync</span>
        </div>
      </div>
    </Modal>
  );
}
