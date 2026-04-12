/**
 * Propose-strategy display tool — emits a strategy-proposal card when the
 * LLM assembles a trading strategy from conversation context.
 *
 * The `display_` prefix triggers TOOL_CARD events in the chat resolver,
 * which the frontend renders as an editable strategy form.
 */

import { z } from 'zod';

import type { StrategyProposalData } from './display-data.js';
import type { ToolDefinition, ToolResult } from '../core/types.js';
import { DataCapabilitySchema } from '../strategies/capabilities.js';
import { StrategyCategorySchema, TriggerTypeSchema } from '../strategies/types.js';

const ProposeStrategyParamsSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  category: StrategyCategorySchema,
  style: z.string().min(1),
  requires: z.array(DataCapabilitySchema).default([]),
  content: z.string().min(1),
  triggers: z
    .array(
      z.object({
        type: TriggerTypeSchema,
        description: z.string().min(1),
        params: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1),
  tickers: z.array(z.string()).default([]),
  maxPositionSize: z.number().optional(),
});

export function createProposeStrategyTool(): ToolDefinition {
  return {
    name: 'display_propose_strategy',
    description:
      'Propose or update a trading strategy. Call this when you have enough information to assemble a strategy. The result will be shown to the user as an editable form. You can call this multiple times as the strategy evolves.',
    parameters: ProposeStrategyParamsSchema,
    async execute(params: unknown): Promise<ToolResult> {
      const parsed = ProposeStrategyParamsSchema.safeParse(params);
      if (!parsed.success) {
        return {
          content: `Invalid strategy proposal: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
          isError: true,
        };
      }

      const data = parsed.data;

      // Clamp maxPositionSize to 0-1
      if (data.maxPositionSize !== undefined) {
        data.maxPositionSize = Math.max(0, Math.min(1, data.maxPositionSize));
      }

      const cardData: StrategyProposalData = {
        name: data.name,
        description: data.description,
        category: data.category,
        style: data.style,
        requires: data.requires,
        content: data.content,
        triggers: data.triggers,
        tickers: data.tickers,
        maxPositionSize: data.maxPositionSize,
      };

      const triggerSummary = data.triggers.map((t) => `${t.type}: ${t.description}`).join(', ');

      return {
        content:
          `Proposing strategy "${data.name}" (${data.category}, ${data.style}).\n` +
          `Triggers: ${triggerSummary}.\n` +
          `${data.tickers.length > 0 ? `Tickers: ${data.tickers.join(', ')}.` : 'Applies to all portfolio tickers.'}`,
        displayCard: { type: 'strategy-proposal', data: cardData },
      };
    },
  };
}
