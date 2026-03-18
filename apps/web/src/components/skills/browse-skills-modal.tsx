import { useCallback, useMemo, useState } from 'react';

import { cn } from '../../lib/utils.js';
import Badge from '../common/badge.js';
import type { BadgeVariant } from '../common/badge.js';
import Modal from '../common/modal.js';
import type { SkillCategory } from './types.js';

interface BrowseSkillsModalProps {
  open: boolean;
  onClose: () => void;
}

type FilterCategory = 'ALL' | SkillCategory;

interface Template {
  name: string;
  category: SkillCategory;
  description: string;
  iconBg: string;
  icon: React.ReactNode;
}

const sidebarItems: { key: FilterCategory; label: string }[] = [
  { key: 'ALL', label: 'All Templates' },
  { key: 'RISK', label: 'Risk' },
  { key: 'PORTFOLIO', label: 'Portfolio' },
  { key: 'MARKET', label: 'Market' },
  { key: 'RESEARCH', label: 'Research' },
];

const categoryVariant: Record<SkillCategory, BadgeVariant> = {
  RISK: 'error',
  PORTFOLIO: 'warning',
  MARKET: 'market',
  RESEARCH: 'success',
};

function IconShield() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
      />
    </svg>
  );
}

function IconChart() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"
      />
    </svg>
  );
}

function IconBolt() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z"
      />
    </svg>
  );
}

function IconScale() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0 0 12 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52 2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 0 1-2.031.352 5.988 5.988 0 0 1-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971Zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0 2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 0 1-2.031.352 5.989 5.989 0 0 1-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971Z"
      />
    </svg>
  );
}

function IconGlobe() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418"
      />
    </svg>
  );
}

function IconClock() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function IconEye() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}

function IconNewspaper() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 0 1-2.25 2.25M16.5 7.5V18a2.25 2.25 0 0 0 2.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 0 0 2.25 2.25h13.5"
      />
    </svg>
  );
}

const iconBgs: Record<string, string> = {
  risk1: 'bg-error/20 text-error',
  risk2: 'bg-error/20 text-error',
  portfolio1: 'bg-warning/20 text-warning',
  portfolio2: 'bg-warning/20 text-warning',
  market1: 'bg-market/20 text-market',
  market2: 'bg-market/20 text-market',
  research1: 'bg-success/20 text-success',
  research2: 'bg-success/20 text-success',
  scheduled1: 'bg-info/20 text-info',
  scheduled2: 'bg-info/20 text-info',
};

const templates: Template[] = [
  {
    name: 'Drawdown Alert',
    category: 'RISK',
    description: 'Get notified when a position drops below threshold',
    iconBg: iconBgs.risk1,
    icon: <IconShield />,
  },
  {
    name: 'VaR Breach',
    category: 'RISK',
    description: 'Alert when Value at Risk exceeds limit',
    iconBg: iconBgs.risk2,
    icon: <IconBolt />,
  },
  {
    name: 'Concentration Monitor',
    category: 'PORTFOLIO',
    description: 'Monitor when single positions grow too large',
    iconBg: iconBgs.portfolio1,
    icon: <IconScale />,
  },
  {
    name: 'Rebalance Reminder',
    category: 'PORTFOLIO',
    description: 'Detect drift from target allocation',
    iconBg: iconBgs.portfolio2,
    icon: <IconChart />,
  },
  {
    name: 'Price Alert',
    category: 'MARKET',
    description: 'Automatically alert when price crosses a level',
    iconBg: iconBgs.market1,
    icon: <IconBolt />,
  },
  {
    name: 'Earnings Watch',
    category: 'MARKET',
    description: 'Alert when holdings report earnings soon',
    iconBg: iconBgs.market2,
    icon: <IconClock />,
  },
  {
    name: 'Sentiment Tracker',
    category: 'RESEARCH',
    description: 'Monitor sentiment shifts via Keelson',
    iconBg: iconBgs.research1,
    icon: <IconEye />,
  },
  {
    name: 'News Monitor',
    category: 'RESEARCH',
    description: 'Track breaking news for holdings',
    iconBg: iconBgs.research2,
    icon: <IconNewspaper />,
  },
  {
    name: 'Daily Briefing',
    category: 'PORTFOLIO',
    description: 'Scheduled daily portfolio summary',
    iconBg: iconBgs.scheduled1,
    icon: <IconClock />,
  },
  {
    name: 'Weekly Report',
    category: 'MARKET',
    description: 'Automated weekly summary via email',
    iconBg: iconBgs.scheduled2,
    icon: <IconGlobe />,
  },
];

export default function BrowseSkillsModal({ open, onClose }: BrowseSkillsModalProps) {
  const [activeFilter, setActiveFilter] = useState<FilterCategory>('ALL');
  const [search, setSearch] = useState('');

  const handleClose = useCallback(() => {
    setActiveFilter('ALL');
    setSearch('');
    onClose();
  }, [onClose]);

  const filtered = useMemo(() => {
    let result = templates;
    if (activeFilter !== 'ALL') {
      result = result.filter((t) => t.category === activeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q));
    }
    return result;
  }, [activeFilter, search]);

  return (
    <Modal
      open={open}
      onClose={handleClose}
      maxWidth="max-w-[780px]"
      className="h-[600px] max-h-none overflow-hidden flex flex-col p-0"
      aria-labelledby="browse-skills-title"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4">
        <h2 id="browse-skills-title" className="font-headline text-xl text-text-primary">
          Create New Skill
        </h2>
        <button
          onClick={handleClose}
          className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Body: sidebar + content */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <nav className="w-[160px] shrink-0 border-r border-border px-3 py-2 space-y-0.5">
          {sidebarItems.map((item) => (
            <button
              key={item.key}
              onClick={() => setActiveFilter(item.key)}
              className={cn(
                'w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors text-left',
                activeFilter === item.key
                  ? 'text-accent-primary bg-accent-glow font-medium'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
              )}
            >
              {item.label}
              <svg
                className="w-3.5 h-3.5 opacity-50"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1 flex flex-col min-h-0 px-5 py-2">
          {/* Search */}
          <div className="relative mb-4">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
              />
            </svg>
            <input
              type="text"
              placeholder="Search templates..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-bg-card border border-border rounded-lg pl-10 pr-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-light transition-colors"
            />
          </div>

          {/* Template grid */}
          <div className="flex-1 overflow-y-auto pr-1 -mr-1">
            <div className="grid grid-cols-2 gap-3">
              {filtered.map((t) => (
                <button
                  key={t.name}
                  className="bg-bg-card border border-border rounded-xl p-4 text-left hover:border-accent-primary hover:shadow-[0_0_12px_var(--color-accent-glow)] transition-all flex gap-3.5 items-start group cursor-pointer"
                >
                  <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', t.iconBg)}>
                    {t.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-text-primary font-medium text-sm transition-colors">{t.name}</div>
                    <div className="text-text-muted text-xs mt-0.5 leading-relaxed">{t.description}</div>
                    <Badge variant={categoryVariant[t.category]} className="mt-2 rounded">
                      {t.category.charAt(0) + t.category.slice(1).toLowerCase()}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>

            {filtered.length === 0 && (
              <div className="flex items-center justify-center py-12 text-text-muted text-sm">
                No templates match your search
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-6 py-4 border-t border-border">
        <button className="flex items-center gap-1.5 text-text-muted text-sm hover:text-text-secondary transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418"
            />
          </svg>
          Browse all templates
        </button>
        <button className="bg-bg-tertiary border border-border hover:border-border-light text-text-primary px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-bg-hover">
          Start from Blank
        </button>
      </div>
    </Modal>
  );
}
