/**
 * Structured data schemas for chat template cards.
 *
 * Each schema defines an interactive template that channels render
 * natively (inline keyboards on Telegram, Block Kit on Slack,
 * interactive messages on WhatsApp). The web app uses its own React
 * components — these schemas are the channel-agnostic data contract.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

const TemplateIconSchema = z.enum(['portfolio', 'research', 'risk', 'news', 'sparkle']);

const OptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Query Builder
// ---------------------------------------------------------------------------

export const QueryBuilderTemplateSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  suggestions: z
    .array(
      z.object({
        id: z.string().min(1),
        icon: TemplateIconSchema.optional(),
        label: z.string().min(1),
        query: z.string().min(1),
        prefill: z.boolean().optional(),
      }),
    )
    .min(1),
});

export type QueryBuilderTemplate = z.infer<typeof QueryBuilderTemplateSchema>;

// ---------------------------------------------------------------------------
// Option Selector
// ---------------------------------------------------------------------------

export const OptionSelectorTemplateSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  layout: z.enum(['grid', 'stack']),
  options: z.array(OptionSchema).min(1),
  backId: z.string().optional(),
});

export type OptionSelectorTemplate = z.infer<typeof OptionSelectorTemplateSchema>;

// ---------------------------------------------------------------------------
// Waterfall Step
// ---------------------------------------------------------------------------

export const WaterfallStepTemplateSchema = z.object({
  flowId: z.string().min(1),
  stepId: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  layout: z.enum(['grid', 'stack']),
  options: z.array(OptionSchema).min(1),
});

export type WaterfallStepTemplate = z.infer<typeof WaterfallStepTemplateSchema>;

// ---------------------------------------------------------------------------
// Manual Position Step
// ---------------------------------------------------------------------------

export const ManualPositionStepTemplateSchema = z.object({
  step: z.enum(['symbol', 'account', 'quantity', 'price', 'confirm', 'success']),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  formState: z.object({
    symbol: z.string().optional(),
    account: z.string().optional(),
    quantity: z.string().optional(),
    costBasis: z.string().optional(),
  }),
  presets: z.array(z.string()).optional(),
});

export type ManualPositionStepTemplate = z.infer<typeof ManualPositionStepTemplateSchema>;

// ---------------------------------------------------------------------------
// Briefing Hero
// ---------------------------------------------------------------------------

export const BriefingHeroTemplateSchema = z.object({
  variant: z.enum(['morning', 'full']),
  date: z.string().min(1),
  updatedAt: z.string().optional(),
  stats: z.array(z.object({ value: z.string(), label: z.string() })).min(1),
  ctaLabel: z.string().optional(),
  ctaActionId: z.string().optional(),
});

export type BriefingHeroTemplate = z.infer<typeof BriefingHeroTemplateSchema>;

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

export const ChatTemplateSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('query-builder'), data: QueryBuilderTemplateSchema }),
  z.object({ type: z.literal('option-selector'), data: OptionSelectorTemplateSchema }),
  z.object({ type: z.literal('waterfall-step'), data: WaterfallStepTemplateSchema }),
  z.object({ type: z.literal('manual-position-step'), data: ManualPositionStepTemplateSchema }),
  z.object({ type: z.literal('briefing-hero'), data: BriefingHeroTemplateSchema }),
]);

export type ChatTemplate = z.infer<typeof ChatTemplateSchema>;
