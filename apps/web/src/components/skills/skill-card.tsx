import type { Skill, SkillCategory } from './types.js';
import Badge from '../common/badge';
import type { BadgeVariant } from '../common/badge';

const categoryVariant: Record<SkillCategory, BadgeVariant> = {
  RISK: 'error',
  PORTFOLIO: 'warning',
  MARKET: 'market',
  RESEARCH: 'success',
};

const sourceVariant: Record<string, BadgeVariant> = {
  'built-in': 'neutral',
  custom: 'warning',
};

export default function SkillCard({ skill }: { skill: Skill }) {
  return (
    <div className="bg-bg-card border border-border rounded-xl p-4 hover:border-accent-primary hover:shadow-[0_0_12px_var(--color-accent-glow)] transition-all flex flex-col justify-between min-h-[160px] cursor-pointer">
      <div>
        <div className="flex items-start justify-between">
          <Badge
            variant={categoryVariant[skill.category]}
            size="xs"
            outline
            className="rounded font-semibold tracking-wide uppercase"
          >
            {skill.category}
          </Badge>
          {skill.active && <div className="h-2 w-2 rounded-full bg-success mt-0.5" />}
        </div>

        <h3 className="text-text-primary font-semibold mt-2.5 text-sm leading-snug">{skill.name}</h3>
        <p className="text-text-secondary text-xs mt-1 leading-relaxed">{skill.description}</p>
      </div>

      <div className="flex items-center gap-2 mt-4 pt-1">
        <Badge variant={sourceVariant[skill.source]} className="rounded">
          {skill.source === 'built-in' ? 'System' : 'User'}
        </Badge>
        <span className="text-text-muted text-2xs">
          Created by {skill.createdBy} &bull; {skill.createdAt}
        </span>
      </div>
    </div>
  );
}
