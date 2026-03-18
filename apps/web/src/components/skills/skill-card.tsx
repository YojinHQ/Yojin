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
    <div className="bg-bg-card border border-border rounded-xl p-5 hover:border-accent-primary hover:shadow-[0_0_12px_var(--color-accent-glow)] transition-all flex flex-col justify-between min-h-[180px] cursor-pointer">
      <div>
        <div className="flex items-start justify-between">
          <span
            className={cn(
              'inline-block rounded px-2.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase border',
              categoryColors[skill.category],
            )}
          >
            {skill.category}
          </span>
          {skill.active && <div className="h-2.5 w-2.5 rounded-full bg-success mt-0.5" />}
        </div>

        <h3 className="text-text-primary font-semibold mt-3 text-[15px] leading-snug">{skill.name}</h3>
        <p className="text-text-secondary text-sm mt-1.5 leading-relaxed">{skill.description}</p>
      </div>

      <div className="flex items-center gap-2 mt-4 pt-1">
        <span className={cn('inline-block rounded px-2 py-0.5 text-[11px] font-medium', sourceStyles[skill.source])}>
          {skill.source === 'built-in' ? 'System' : 'User'}
        </span>
        <span className="text-text-muted text-xs">
          Created by {skill.createdBy} &bull; {skill.createdAt}
        </span>
      </div>
    </div>
  );
}
