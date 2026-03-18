import { useState } from 'react';

import SkillCard from './skill-card.js';
import SkillCardAdd from './skill-card-add.js';
import BrowseSkillsModal from './browse-skills-modal.js';
import type { Skill } from './types.js';

const mockSkills: Skill[] = [
  {
    id: '1',
    name: 'Critical Drawdown Alert',
    description:
      'Sends a critical alert and auto-drafts a hedge recommendation when any position exceeds -10% drawdown.',
    category: 'RISK',
    active: true,
    source: 'built-in',
    createdBy: 'Yojin',
    createdAt: 'Jan 3, 2026',
  },
  {
    id: '2',
    name: 'Concentration Warning',
    description:
      'Alerts you with a detailed exposure breakdown when any single position exceeds 30% of portfolio value.',
    category: 'PORTFOLIO',
    active: true,
    source: 'built-in',
    createdBy: 'Yojin',
    createdAt: 'Jan 3, 2026',
  },
  {
    id: '3',
    name: 'Earnings Calendar Alert',
    description: 'Notifies you and shows analyst estimates when a holding reports earnings within 3 days.',
    category: 'MARKET',
    active: true,
    source: 'built-in',
    createdBy: 'Yojin',
    createdAt: 'Jan 3, 2026',
  },
  {
    id: '4',
    name: 'Correlation Spike',
    description: 'Alerts you and recalculates risk when portfolio correlation increases by more than 15%.',
    category: 'RISK',
    active: true,
    source: 'built-in',
    createdBy: 'Yojin',
    createdAt: 'Jan 3, 2026',
  },
  {
    id: '5',
    name: 'Daily Portfolio Briefing',
    description: 'Generates a morning portfolio summary every day at 8 AM to keep you informed.',
    category: 'PORTFOLIO',
    active: true,
    source: 'built-in',
    createdBy: 'Yojin',
    createdAt: 'Jan 3, 2026',
  },
  {
    id: '6',
    name: 'Sector Rotation Signal',
    description: 'Sends an alert and suggests rebalancing when sector fund flows indicate rotation patterns.',
    category: 'MARKET',
    active: true,
    source: 'built-in',
    createdBy: 'Yojin',
    createdAt: 'Jan 3, 2026',
  },
  {
    id: '7',
    name: 'Sentiment Shift Alert',
    description: 'Emails you and drafts a research note when Keelson sentiment score shifts significantly.',
    category: 'RESEARCH',
    active: true,
    source: 'custom',
    createdBy: 'Dean',
    createdAt: 'Jan 12, 2026',
  },
  {
    id: '8',
    name: 'Technical Breakout',
    description: 'Posts to Slack and highlights the chart when price breaks above key resistance levels.',
    category: 'RISK',
    active: true,
    source: 'custom',
    createdBy: 'Dean',
    createdAt: 'Jan 14, 2026',
  },
  {
    id: '9',
    name: 'Weekly Risk Summary',
    description: 'Sends a weekly portfolio risk assessment report via email every Friday at 6 PM.',
    category: 'MARKET',
    active: true,
    source: 'custom',
    createdBy: 'Dean',
    createdAt: 'Jan 15, 2026',
  },
  {
    id: '10',
    name: 'VaR Breach Alert',
    description:
      'Sends an alert and offers hedging options when Value at Risk drops below threshold during volatile seasons.',
    category: 'RESEARCH',
    active: true,
    source: 'custom',
    createdBy: 'Dean',
    createdAt: 'Jan 16, 2026',
  },
];

export default function ActiveRulesView() {
  const [browseOpen, setBrowseOpen] = useState(false);

  return (
    <div className="space-y-6">
      <h2 className="font-headline text-lg text-text-primary">Active Skills</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {mockSkills.map((skill) => (
          <SkillCard key={skill.id} skill={skill} />
        ))}
        <SkillCardAdd onClick={() => setBrowseOpen(true)} />
      </div>

      <div className="flex justify-end pt-2">
        <button className="flex items-center gap-2 text-text-muted text-sm hover:text-text-secondary transition-colors px-3 py-1.5 rounded-lg border border-border hover:border-border-light">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
            />
          </svg>
          Reset Demo
        </button>
      </div>

      <BrowseSkillsModal open={browseOpen} onClose={() => setBrowseOpen(false)} />
    </div>
  );
}
