/**
 * Propose-strategy display tool — emits a strategy-proposal card when the
 * LLM assembles a trading strategy from conversation context.
 *
 * The `display_` prefix triggers TOOL_CARD events in the chat resolver,
 * which the frontend renders as an editable strategy form.
 *
 * The tool uses a typed discriminated union for trigger conditions so
 * the LLM sees exact valid enum values (indicator names, directions)
 * instead of an open-ended Record<string, unknown>.
 */

import { z } from 'zod';

import type { StrategyProposalData } from './display-data.js';
import type { ToolDefinition, ToolResult } from '../core/types.js';
import { deriveCapabilities } from '../strategies/capabilities.js';
import type { TriggerGroup } from '../strategies/types.js';
import { StrategyCategorySchema, StrategyStyleSchema } from '../strategies/types.js';

// ---------------------------------------------------------------------------
// Typed enums for LLM guidance — these become part of the tool schema
// so the LLM sees the exact valid values when calling the tool.
// ---------------------------------------------------------------------------

const IndicatorEnum = z.enum([
  'RSI',
  'EMA',
  'SMA',
  'ATR',
  'VWMA',
  'MFI',
  'MACD',
  'MACD_LINE',
  'MACD_SIGNAL',
  'BB_UPPER',
  'BB_MIDDLE',
  'BB_LOWER',
]);

const IndicatorDirectionEnum = z.enum(['above', 'below', 'crosses_above', 'crosses_below']);

const PriceDirectionEnum = z.enum(['drop', 'rise']);

const MetricEnum = z.enum(['priceToBook', 'bookValue', 'SUE', 'sentiment_momentum_24h', 'roe']);

const SignalTypeEnum = z.enum([
  'NEWS',
  'FUNDAMENTAL',
  'SENTIMENT',
  'TECHNICAL',
  'MACRO',
  'FILINGS',
  'SOCIALS',
  'TRADING_LOGIC_TRIGGER',
]);

// ---------------------------------------------------------------------------
// Per-trigger-type condition schemas (discriminated union)
// ---------------------------------------------------------------------------

const IndicatorThresholdCondition = z.object({
  type: z.literal('INDICATOR_THRESHOLD'),
  description: z.string().min(1),
  params: z.object({
    indicator: IndicatorEnum,
    threshold: z.number(),
    direction: IndicatorDirectionEnum,
  }),
});

const PriceMoveCondition = z.object({
  type: z.literal('PRICE_MOVE'),
  description: z.string().min(1),
  params: z.object({
    threshold: z.number().describe('Fraction, e.g. -0.05 for 5% drop'),
    direction: PriceDirectionEnum.optional(),
    lookback_months: z
      .union([z.literal(3), z.literal(6), z.literal(12)])
      .optional()
      .describe('3, 6, or 12'),
  }),
});

const DrawdownCondition = z.object({
  type: z.literal('DRAWDOWN'),
  description: z.string().min(1),
  params: z.object({
    threshold: z.number().describe('Negative fraction, e.g. -0.10 for 10% drawdown'),
  }),
});

const EarningsProximityCondition = z.object({
  type: z.literal('EARNINGS_PROXIMITY'),
  description: z.string().min(1),
  params: z.object({
    withinDays: z.number(),
  }),
});

const MetricThresholdCondition = z.object({
  type: z.literal('METRIC_THRESHOLD'),
  description: z.string().min(1),
  params: z.object({
    metric: MetricEnum,
    threshold: z.number(),
    direction: IndicatorDirectionEnum,
  }),
});

const ConcentrationDriftCondition = z.object({
  type: z.literal('CONCENTRATION_DRIFT'),
  description: z.string().min(1),
  params: z.object({
    maxWeight: z.number().describe('Fraction 0-1, e.g. 0.15 for 15%'),
  }),
});

const SignalPresentCondition = z.object({
  type: z.literal('SIGNAL_PRESENT'),
  description: z.string().min(1),
  params: z.object({
    signal_types: z.array(SignalTypeEnum).min(1),
    min_sentiment: z.number().min(0).max(1).optional(),
    lookback_hours: z.number().optional(),
  }),
});

const CustomCondition = z.object({
  type: z.literal('CUSTOM'),
  description: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
});

const TypedConditionSchema = z.discriminatedUnion('type', [
  IndicatorThresholdCondition,
  PriceMoveCondition,
  DrawdownCondition,
  EarningsProximityCondition,
  MetricThresholdCondition,
  ConcentrationDriftCondition,
  SignalPresentCondition,
  CustomCondition,
]);

// ---------------------------------------------------------------------------
// Full tool schema
// ---------------------------------------------------------------------------

const ProposeStrategyParamsSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  category: StrategyCategorySchema,
  style: StrategyStyleSchema,
  content: z.string().min(1),
  triggerGroups: z
    .array(
      z.object({
        label: z.string().default(''),
        conditions: z.array(TypedConditionSchema).min(1),
      }),
    )
    .min(1),
  tickers: z.array(z.string()).default([]),
  maxPositionSize: z.number().optional(),
});

// ---------------------------------------------------------------------------
// Normalizer — catches LLM mistakes that slip past the typed schema
// ---------------------------------------------------------------------------

// Order matters: more specific patterns must come first.
/** Keyword-to-indicator mapping for auto-correction. */
const INDICATOR_KEYWORDS: [RegExp, string][] = [
  [/\bmacd\b.*\bhistogram\b|\bhistogram\b.*\bmacd\b/i, 'MACD'],
  [/\bmacd\b.*\bsignal\b|\bsignal\b.*\bmacd\b/i, 'MACD_SIGNAL'],
  [/\bmacd\b.*\bline\b|\bline\b.*\bmacd\b/i, 'MACD_LINE'],
  [/\bmacd\b/i, 'MACD'],
  [/\bbollinger\b.*\blower\b|\blower\b.*\bbollinger\b/i, 'BB_LOWER'],
  [/\bbollinger\b.*\bupper\b|\bupper\b.*\bbollinger\b/i, 'BB_UPPER'],
  [/\bbollinger\b.*\bmiddle\b|\bmiddle\b.*\bbollinger\b/i, 'BB_MIDDLE'],
  [/\bbollinger\b|\bbb\b/i, 'BB_MIDDLE'],
  [/\brsi\b/i, 'RSI'],
  [/\bema\b/i, 'EMA'],
  [/\bsma\b/i, 'SMA'],
  [/\batr\b/i, 'ATR'],
  [/\bvwma\b/i, 'VWMA'],
  [/\bmfi\b|money\s*flow/i, 'MFI'],
];

function inferIndicatorFromDescription(description: string): string | null {
  for (const [pattern, indicator] of INDICATOR_KEYWORDS) {
    if (pattern.test(description)) return indicator;
  }
  return null;
}

type ParsedCondition = z.infer<typeof TypedConditionSchema>;

/**
 * Auto-correct indicator params when the description clearly contradicts
 * the indicator value. Only fires for INDICATOR_THRESHOLD conditions.
 */
function normalizeCondition(condition: ParsedCondition): ParsedCondition {
  if (condition.type !== 'INDICATOR_THRESHOLD') return condition;

  const inferred = inferIndicatorFromDescription(condition.description);
  if (inferred && inferred !== condition.params.indicator) {
    return {
      ...condition,
      params: { ...condition.params, indicator: inferred as z.infer<typeof IndicatorEnum> },
    };
  }
  return condition;
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export function createProposeStrategyTool(): ToolDefinition {
  return {
    name: 'display_propose_strategy',
    description:
      'Propose or update a trading strategy. Call this when you have enough information to assemble a strategy. ' +
      'The result will be shown to the user as an editable form. You can call this multiple times as the strategy evolves.\n\n' +
      'IMPORTANT: For INDICATOR_THRESHOLD conditions, params.indicator must match the indicator described. ' +
      'Available indicators: RSI, EMA, SMA, ATR, VWMA, MFI, MACD (histogram), MACD_LINE, MACD_SIGNAL, ' +
      'BB_UPPER (Bollinger upper), BB_MIDDLE (Bollinger middle), BB_LOWER (Bollinger lower). ' +
      'Do NOT default all indicators to RSI — use the correct indicator for each condition.',
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

      // Normalize conditions — auto-correct indicator mismatches
      const normalizedGroups = data.triggerGroups.map((g) => ({
        ...g,
        conditions: g.conditions.map(normalizeCondition),
      }));

      // Auto-derive required capabilities from trigger types
      const cardTriggerGroups = normalizedGroups.map((g) => ({
        label: g.label,
        conditions: g.conditions.map((c) => ({
          type: c.type,
          description: c.description,
          params: 'params' in c && c.params ? (c.params as Record<string, unknown>) : undefined,
        })),
      }));
      const requires = deriveCapabilities(cardTriggerGroups as TriggerGroup[]);

      const cardData: StrategyProposalData = {
        name: data.name,
        description: data.description,
        category: data.category,
        style: data.style.toUpperCase(),
        requires,
        content: data.content,
        triggerGroups: cardTriggerGroups,
        tickers: data.tickers,
        maxPositionSize: data.maxPositionSize,
      };

      const triggerSummary = normalizedGroups
        .flatMap((g) => g.conditions.map((c) => `${c.type}: ${c.description}`))
        .join(', ');

      return {
        content:
          `Proposing strategy "${data.name}" (${data.category}, ${data.style.toUpperCase()}).\n` +
          `Triggers: ${triggerSummary}.\n` +
          `${data.tickers.length > 0 ? `Tickers: ${data.tickers.join(', ')}.` : 'Applies to all portfolio tickers.'}`,
        displayCard: { type: 'strategy-proposal', data: cardData },
      };
    },
  };
}
