import { useEffect } from 'react';

interface BrowseSkillsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function BrowseSkillsModal({ open, onClose }: BrowseSkillsModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const templates = [
    {
      name: 'Price Alert',
      category: 'MARKET',
      description: 'Alert when price crosses a threshold',
    },
    {
      name: 'Volume Spike',
      category: 'MARKET',
      description: 'Detect unusual volume activity',
    },
    {
      name: 'Rebalance Reminder',
      category: 'PORTFOLIO',
      description: 'Periodic portfolio rebalance checks',
    },
    {
      name: 'Dividend Tracker',
      category: 'PORTFOLIO',
      description: 'Track upcoming dividend payments',
    },
    {
      name: 'VaR Breach',
      category: 'RISK',
      description: 'Alert on Value at Risk threshold breach',
    },
    {
      name: 'News Sentiment',
      category: 'RESEARCH',
      description: 'Monitor sentiment changes in news',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Browse Skills"
        className="relative bg-bg-secondary border border-border rounded-2xl p-6 w-full max-w-2xl max-h-[80vh] overflow-auto"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-headline text-xl text-text-primary">Browse Skills</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {templates.map((t) => (
            <button
              key={t.name}
              className="bg-bg-card border border-border rounded-xl p-4 text-left hover:border-border-light transition-colors"
            >
              <div className="text-text-primary font-medium text-sm">{t.name}</div>
              <div className="text-text-muted text-xs mt-1">{t.description}</div>
              <div className="text-accent-primary text-xs mt-2">+ Add to active rules</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
