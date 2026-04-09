/**
 * Skill tools — expose trading strategy management as agent tools.
 *
 * These tools let the Strategist and Risk Manager browse, activate,
 * and evaluate skills through the TAO loop.
 */

import { z } from 'zod';

import { checkCapabilities } from './capabilities.js';
import type { CapabilityCheckResult } from './capabilities.js';
import type { SkillEvaluator } from './skill-evaluator.js';
import type { SkillStore } from './skill-store.js';
import { SkillCategorySchema } from './types.js';
import type { Skill } from './types.js';
import type { ToolDefinition, ToolResult } from '../core/types.js';

export interface SkillToolsOptions {
  skillStore: SkillStore;
  skillEvaluator: SkillEvaluator;
}

export function createSkillTools(options: SkillToolsOptions): ToolDefinition[] {
  const { skillStore, skillEvaluator } = options;

  const listSkills: ToolDefinition = {
    name: 'list_skills',
    description:
      'List trading skills/strategies with optional filters. ' +
      'Returns a summary of each skill including capability status (executable/limited/unavailable).',
    parameters: z.object({
      category: SkillCategorySchema.optional().describe('Filter by category (RISK, PORTFOLIO, MARKET, RESEARCH)'),
      style: z.string().optional().describe('Filter by trading style (e.g. momentum, value, mean-reversion)'),
      active: z.boolean().optional().describe('Filter by active status'),
      query: z.string().optional().describe('Search query — matches against name and description'),
    }),
    async execute(params: {
      category?: string;
      style?: string;
      active?: boolean;
      query?: string;
    }): Promise<ToolResult> {
      let skills = skillStore.getAll();

      if (params.category) {
        skills = skills.filter((s) => s.category === params.category);
      }
      if (params.style) {
        skills = skills.filter((s) => s.style === params.style);
      }
      if (params.active !== undefined) {
        skills = skills.filter((s) => s.active === params.active);
      }
      if (params.query) {
        const q = params.query.toLowerCase();
        skills = skills.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
      }

      if (skills.length === 0) {
        return { content: 'No skills found matching the given filters.' };
      }

      const lines = skills.map((s) => formatSkillSummary(s));
      return { content: `${skills.length} skill(s) found:\n\n${lines.join('\n\n')}` };
    },
  };

  const getSkill: ToolDefinition = {
    name: 'get_skill',
    description: 'Get full details of a skill including content, triggers, metadata, and capability breakdown.',
    parameters: z.object({
      id: z.string().min(1).describe('Skill ID'),
    }),
    async execute(params: { id: string }): Promise<ToolResult> {
      const skill = skillStore.getById(params.id);
      if (!skill) {
        return { content: `Skill not found: ${params.id}`, isError: true };
      }

      const cap = checkCapabilities(skill.requires);
      const triggers = skill.triggers.map((t) => `  - ${t.type}: ${t.description}`).join('\n');

      const content = [
        `# ${skill.name}`,
        `ID: ${skill.id}`,
        `Category: ${skill.category} | Style: ${skill.style} | Active: ${skill.active}`,
        `Source: ${skill.source} | Created by: ${skill.createdBy}`,
        `Tickers: ${skill.tickers.length > 0 ? skill.tickers.join(', ') : 'all portfolio'}`,
        skill.maxPositionSize !== undefined ? `Max position size: ${(skill.maxPositionSize * 100).toFixed(0)}%` : '',
        '',
        `## Capabilities — ${cap.status}`,
        formatCapabilityBreakdown(cap),
        '',
        `## Triggers`,
        triggers,
        '',
        `## Strategy Content`,
        skill.content,
      ]
        .filter(Boolean)
        .join('\n');

      return { content };
    },
  };

  const activateSkill: ToolDefinition = {
    name: 'activate_skill',
    description: 'Activate a skill so its triggers are evaluated. Warns if required data capabilities are missing.',
    parameters: z.object({
      id: z.string().min(1).describe('Skill ID to activate'),
    }),
    async execute(params: { id: string }): Promise<ToolResult> {
      const updated = skillStore.setActive(params.id, true);
      if (!updated) {
        return { content: `Skill not found: ${params.id}`, isError: true };
      }

      const cap = checkCapabilities(updated.requires);
      let content = `Skill "${updated.name}" activated.`;

      if (cap.missing.length > 0) {
        content += `\n\nWarning: ${cap.status} — missing capabilities: ${cap.missing.join(', ')}. Some triggers may not fire.`;
      }

      return { content };
    },
  };

  const deactivateSkill: ToolDefinition = {
    name: 'deactivate_skill',
    description: 'Deactivate a skill so its triggers are no longer evaluated.',
    parameters: z.object({
      id: z.string().min(1).describe('Skill ID to deactivate'),
    }),
    async execute(params: { id: string }): Promise<ToolResult> {
      const updated = skillStore.setActive(params.id, false);
      if (!updated) {
        return { content: `Skill not found: ${params.id}`, isError: true };
      }
      return { content: `Skill "${updated.name}" deactivated.` };
    },
  };

  const getSkillEvaluations: ToolDefinition = {
    name: 'get_skill_evaluations',
    description:
      'Evaluate all active skills against current portfolio state. ' +
      'Returns fired triggers with strategy instructions, or a summary if none fired.',
    parameters: z.object({}),
    async execute(): Promise<ToolResult> {
      const activeSkills = skillStore.getActive();
      if (activeSkills.length === 0) {
        return { content: 'No active skills to evaluate.' };
      }

      const evaluations = skillEvaluator.evaluate({
        weights: {},
        prices: {},
        priceChanges: {},
        indicators: {},
        earningsDays: {},
        portfolioDrawdown: 0,
        positionDrawdowns: {},
        metrics: {},
        signals: {},
      });

      const contextNote =
        'Note: Evaluated with empty portfolio context — no live prices, weights, or indicators available. ' +
        'Use the Strategist orchestrated workflow for full evaluation with real portfolio data.';

      if (evaluations.length === 0) {
        const capSummaries = activeSkills
          .map((s) => {
            const cap = checkCapabilities(s.requires);
            return cap.missing.length > 0 ? `  - ${s.name}: missing ${cap.missing.join(', ')}` : null;
          })
          .filter(Boolean);

        let content = `No skill triggers fired.\n\n${contextNote}`;
        if (capSummaries.length > 0) {
          content += `\n\nSkills with missing capabilities:\n${capSummaries.join('\n')}`;
        }
        return { content };
      }

      return { content: `${skillEvaluator.formatForStrategist(evaluations)}\n\n${contextNote}` };
    },
  };

  return [listSkills, getSkill, activateSkill, deactivateSkill, getSkillEvaluations];
}

function formatSkillSummary(skill: Skill): string {
  const cap = checkCapabilities(skill.requires);
  return [
    `**${skill.name}** (${skill.id})`,
    `  Category: ${skill.category} | Style: ${skill.style} | Active: ${skill.active}`,
    `  Capabilities: ${cap.status}${cap.missing.length > 0 ? ` (missing: ${cap.missing.join(', ')})` : ''}`,
    `  Triggers: ${skill.triggers.map((t) => t.type).join(', ')}`,
  ].join('\n');
}

function formatCapabilityBreakdown(cap: CapabilityCheckResult): string {
  const lines: string[] = [];
  if (cap.available.length > 0) {
    lines.push(`  Available: ${cap.available.join(', ')}`);
  }
  if (cap.missing.length > 0) {
    lines.push(`  Missing: ${cap.missing.join(', ')}`);
  }
  if (cap.required.length === 0) {
    lines.push('  No specific capabilities required.');
  }
  return lines.join('\n');
}
