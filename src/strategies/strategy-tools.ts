/**
 * Strategy tools — expose trading strategy management as agent tools.
 *
 * These tools let the Strategist and Risk Manager browse, activate,
 * and evaluate strategies through the TAO loop.
 */

import { z } from 'zod';

import { checkCapabilities } from './capabilities.js';
import type { CapabilityCheckResult } from './capabilities.js';
import type { StrategyEvaluator } from './strategy-evaluator.js';
import type { StrategyStore } from './strategy-store.js';
import { StrategyCategorySchema } from './types.js';
import type { Strategy } from './types.js';
import type { ToolDefinition, ToolResult } from '../core/types.js';

export interface StrategyToolsOptions {
  strategyStore: StrategyStore;
  strategyEvaluator: StrategyEvaluator;
}

export function createStrategyTools(options: StrategyToolsOptions): ToolDefinition[] {
  const { strategyStore, strategyEvaluator } = options;

  const listStrategies: ToolDefinition = {
    name: 'list_strategies',
    description:
      'List trading strategies/strategies with optional filters. ' +
      'Returns a summary of each strategy including capability status (executable/limited/unavailable).',
    parameters: z.object({
      category: StrategyCategorySchema.optional().describe('Filter by category (RISK, PORTFOLIO, MARKET, RESEARCH)'),
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
      let strategies = strategyStore.getAll();

      if (params.category) {
        strategies = strategies.filter((s) => s.category === params.category);
      }
      if (params.style) {
        strategies = strategies.filter((s) => s.style === params.style);
      }
      if (params.active !== undefined) {
        strategies = strategies.filter((s) => s.active === params.active);
      }
      if (params.query) {
        const q = params.query.toLowerCase();
        strategies = strategies.filter(
          (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
        );
      }

      if (strategies.length === 0) {
        return { content: 'No strategies found matching the given filters.' };
      }

      const lines = strategies.map((s) => formatStrategySummary(s));
      return { content: `${strategies.length} strategy(s) found:\n\n${lines.join('\n\n')}` };
    },
  };

  const getStrategy: ToolDefinition = {
    name: 'get_strategy',
    description: 'Get full details of a strategy including content, triggers, metadata, and capability breakdown.',
    parameters: z.object({
      id: z.string().min(1).describe('Strategy ID'),
    }),
    async execute(params: { id: string }): Promise<ToolResult> {
      const strategy = strategyStore.getById(params.id);
      if (!strategy) {
        return { content: `Strategy not found: ${params.id}`, isError: true };
      }

      const cap = checkCapabilities(strategy.requires);
      const triggers = strategy.triggerGroups
        .map((g, i) => {
          const label = g.label ? ` (${g.label})` : '';
          const conditions = g.conditions.map((c) => `    - ${c.type}: ${c.description}`).join('\n');
          return `  Group ${i + 1}${label} [AND]:\n${conditions}`;
        })
        .join('\n  OR\n');

      const content = [
        `# ${strategy.name}`,
        `ID: ${strategy.id}`,
        `Category: ${strategy.category} | Style: ${strategy.style} | Active: ${strategy.active}`,
        `Source: ${strategy.source} | Created by: ${strategy.createdBy}`,
        `Tickers: ${strategy.tickers.length > 0 ? strategy.tickers.join(', ') : 'all portfolio'}`,
        strategy.maxPositionSize !== undefined
          ? `Max position size: ${(strategy.maxPositionSize * 100).toFixed(0)}%`
          : '',
        '',
        `## Capabilities — ${cap.status}`,
        formatCapabilityBreakdown(cap),
        '',
        `## Triggers`,
        triggers,
        '',
        `## Strategy Content`,
        strategy.content,
      ]
        .filter(Boolean)
        .join('\n');

      return { content };
    },
  };

  const activateStrategy: ToolDefinition = {
    name: 'activate_strategy',
    description: 'Activate a strategy so its triggers are evaluated. Warns if required data capabilities are missing.',
    parameters: z.object({
      id: z.string().min(1).describe('Strategy ID to activate'),
    }),
    async execute(params: { id: string }): Promise<ToolResult> {
      const updated = strategyStore.setActive(params.id, true);
      if (!updated) {
        return { content: `Strategy not found: ${params.id}`, isError: true };
      }

      const cap = checkCapabilities(updated.requires);
      let content = `Strategy "${updated.name}" activated.`;

      if (cap.missing.length > 0) {
        content += `\n\nWarning: ${cap.status} — missing capabilities: ${cap.missing.join(', ')}. Some triggers may not fire.`;
      }

      return { content };
    },
  };

  const deactivateStrategy: ToolDefinition = {
    name: 'deactivate_strategy',
    description: 'Deactivate a strategy so its triggers are no longer evaluated.',
    parameters: z.object({
      id: z.string().min(1).describe('Strategy ID to deactivate'),
    }),
    async execute(params: { id: string }): Promise<ToolResult> {
      const updated = strategyStore.setActive(params.id, false);
      if (!updated) {
        return { content: `Strategy not found: ${params.id}`, isError: true };
      }
      return { content: `Strategy "${updated.name}" deactivated.` };
    },
  };

  const getStrategyEvaluations: ToolDefinition = {
    name: 'get_strategy_evaluations',
    description:
      'Evaluate all active strategies against current portfolio state. ' +
      'Returns fired triggers with strategy instructions, or a summary if none fired.',
    parameters: z.object({}),
    async execute(): Promise<ToolResult> {
      const activeStrategies = strategyStore.getActive();
      if (activeStrategies.length === 0) {
        return { content: 'No active strategies to evaluate.' };
      }

      const evaluations = strategyEvaluator.evaluate({
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
        const capSummaries = activeStrategies
          .map((s) => {
            const cap = checkCapabilities(s.requires);
            return cap.missing.length > 0 ? `  - ${s.name}: missing ${cap.missing.join(', ')}` : null;
          })
          .filter(Boolean);

        let content = `No strategy triggers fired.\n\n${contextNote}`;
        if (capSummaries.length > 0) {
          content += `\n\nStrategies with missing capabilities:\n${capSummaries.join('\n')}`;
        }
        return { content };
      }

      return { content: `${strategyEvaluator.formatForStrategist(evaluations)}\n\n${contextNote}` };
    },
  };

  return [listStrategies, getStrategy, activateStrategy, deactivateStrategy, getStrategyEvaluations];
}

function formatStrategySummary(strategy: Strategy): string {
  const cap = checkCapabilities(strategy.requires);
  return [
    `**${strategy.name}** (${strategy.id})`,
    `  Category: ${strategy.category} | Style: ${strategy.style} | Active: ${strategy.active}`,
    `  Capabilities: ${cap.status}${cap.missing.length > 0 ? ` (missing: ${cap.missing.join(', ')})` : ''}`,
    `  Trigger groups: ${strategy.triggerGroups.length} (${strategy.triggerGroups.flatMap((g) => g.conditions.map((c) => c.type)).join(', ')})`,
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
