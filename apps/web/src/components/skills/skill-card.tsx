import type { Skill, SkillCategory } from './types.js';
import { cn } from '../../lib/utils';

const categoryColors: Record<SkillCategory, string> = {
  RISK: 'border-error text-error',
  PORTFOLIO: 'border-warning text-warning',
  MARKET: 'border-market text-market',
  RESEARCH: 'border-success text-success',
};

const sourceStyles: Record<string, string> = {
  'built-in': 'bg-bg-tertiary text-text-muted',
  custom: 'bg-warning/15 text-warning',
};

export default function SkillCard({ skill }: { skill: Skill }) {
  return (
    <div className="bg-bg-card border border-border rounded-xl p-4 hover:border-accent-primary hover:shadow-[0_0_12px_var(--color-accent-glow)] transition-all flex flex-col justify-between min-h-[160px] cursor-pointer">
      <div>
        <div className="flex items-start justify-between">
          <span
            className={cn(
              'inline-block rounded px-1.5 py-px text-2xs font-semibold tracking-wide uppercase border',
              categoryColors[skill.category],
            )}
          >
            {skill.category}
          </span>
          {skill.active && <div className="h-2 w-2 rounded-full bg-success mt-0.5" />}
        </div>

        <h3 className="text-text-primary font-semibold mt-2.5 text-xs leading-snug">{skill.name}</h3>
        <p className="text-text-secondary text-xs mt-1 leading-relaxed">{skill.description}</p>
      </div>

      <div className="flex items-center gap-2 mt-4 pt-1">
        <span className={cn('inline-block rounded px-1.5 py-px text-2xs font-medium', sourceStyles[skill.source])}>
          {skill.source === 'built-in' ? 'System' : 'User'}
        </span>
        <span className="text-text-muted text-2xs">
          Created by {skill.createdBy} &bull; {skill.createdAt}
        </span>
      </div>
    </div>
  );
}
