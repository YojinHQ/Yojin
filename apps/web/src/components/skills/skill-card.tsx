import type { Skill, SkillCategory } from './types.js';
import { cn } from '../../lib/utils';

const categoryColors: Record<SkillCategory, string> = {
  RISK: 'bg-error/10 text-error',
  PORTFOLIO: 'bg-accent-primary/10 text-accent-primary',
  MARKET: 'bg-info/10 text-info',
  RESEARCH: 'bg-success/10 text-success',
};

export default function SkillCard({ skill }: { skill: Skill }) {
  return (
    <div className="bg-bg-card border border-border rounded-xl p-5 hover:border-border-light transition-colors">
      <div className="flex items-center justify-between">
        <span
          className={cn('inline-block rounded-full px-2.5 py-0.5 text-xs font-medium', categoryColors[skill.category])}
        >
          {skill.category}
        </span>
        {skill.active && <div className="h-2 w-2 rounded-full bg-success" />}
      </div>

      <div className="text-text-primary font-medium mt-3">{skill.name}</div>
      <div className="text-text-secondary text-sm mt-1">{skill.description}</div>

      <div className="mt-4">
        <span className="text-text-muted text-xs">
          {skill.source === 'built-in' ? 'Built-in' : 'Custom'}
        </span>
      </div>
    </div>
  );
}
