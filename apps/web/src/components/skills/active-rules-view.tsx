import { useState } from 'react';

import SkillCard from './skill-card.js';
import SkillCardAdd from './skill-card-add.js';
import BrowseSkillsModal from './browse-skills-modal.js';
import type { Skill, SkillCategory } from './types.js';

const mockSkills: Skill[] = [
  {
    id: '1',
    name: 'Critical Drawdown Alert',
    description: 'Triggers when any position exceeds -10% drawdown from peak value',
    category: 'RISK',
    active: true,
    source: 'built-in',
  },
  {
    id: '2',
    name: 'Concentration Warning',
    description: 'Alerts when single position exceeds 30% of portfolio value',
    category: 'RISK',
    active: true,
    source: 'built-in',
  },
  {
    id: '3',
    name: 'Daily Portfolio Briefing',
    description: 'Morning summary of portfolio performance and key events',
    category: 'PORTFOLIO',
    active: true,
    source: 'built-in',
  },
  {
    id: '4',
    name: 'Earnings Calendar Alert',
    description: 'Notify 3 days before holdings report earnings',
    category: 'PORTFOLIO',
    active: true,
    source: 'built-in',
  },
  {
    id: '5',
    name: 'Correlation Spike Detector',
    description: 'Detects unusual correlation increases between holdings',
    category: 'MARKET',
    active: true,
    source: 'custom',
  },
  {
    id: '6',
    name: 'Sector Rotation Signal',
    description: 'Monitors sector fund flows for rotation patterns',
    category: 'MARKET',
    active: true,
    source: 'built-in',
  },
  {
    id: '7',
    name: 'Sentiment Shift Alert',
    description: 'Triggers on significant sentiment score changes via Keelson',
    category: 'RESEARCH',
    active: true,
    source: 'custom',
  },
  {
    id: '8',
    name: 'Technical Breakout',
    description: 'Detects price breakouts above resistance levels',
    category: 'RESEARCH',
    active: true,
    source: 'built-in',
  },
];

const categories: { key: SkillCategory; label: string }[] = [
  { key: 'RISK', label: 'Risk Management' },
  { key: 'PORTFOLIO', label: 'Portfolio' },
  { key: 'MARKET', label: 'Market Intelligence' },
  { key: 'RESEARCH', label: 'Research' },
];

export default function ActiveRulesView() {
  const [browseOpen, setBrowseOpen] = useState(false);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="font-headline text-lg text-text-primary">Active Rules</h2>
        <button
          onClick={() => setBrowseOpen(true)}
          className="bg-accent-primary hover:bg-accent-secondary text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          Browse Skills
        </button>
      </div>

      {categories.map((cat) => {
        const skills = mockSkills.filter((s) => s.category === cat.key);
        return (
          <div key={cat.key}>
            <h3 className="font-headline text-sm text-text-secondary uppercase tracking-wider mb-4">
              {cat.label}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {skills.map((skill) => (
                <SkillCard key={skill.id} skill={skill} />
              ))}
              <SkillCardAdd />
            </div>
          </div>
        );
      })}

      <BrowseSkillsModal open={browseOpen} onClose={() => setBrowseOpen(false)} />
    </div>
  );
}
