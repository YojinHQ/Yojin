/**
 * Channel-specific chat template formatters.
 *
 * Each function converts a ChatTemplate into a format suitable for the
 * target channel. Unlike display card formatters (which return plain text),
 * template formatters return structured payloads that include interactive
 * elements (inline keyboards, Block Kit actions, etc.).
 */

import { InlineKeyboard } from 'grammy';

import type {
  BriefingHeroTemplate,
  ChatTemplate,
  ManualPositionStepTemplate,
  OptionSelectorTemplate,
  QueryBuilderTemplate,
  WaterfallStepTemplate,
} from './chat-template-data.js';
import { escapeHtml } from '../formatting/index.js';

// ---------------------------------------------------------------------------
// Icon mapping (template icon enum → Telegram emoji)
// ---------------------------------------------------------------------------

const ICON_EMOJI: Record<string, string> = {
  portfolio: '\u{1F4BC}',
  research: '\u{1F50D}',
  risk: '\u{1F6E1}',
  news: '\u{1F4F0}',
  sparkle: '\u{2728}',
};

function iconFor(icon?: string): string {
  return icon ? (ICON_EMOJI[icon] ?? '') : '';
}

// ---------------------------------------------------------------------------
// Telegram formatter result
// ---------------------------------------------------------------------------

export interface TelegramTemplateResult {
  text: string;
  replyMarkup?: InlineKeyboard;
}

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

function assertNever(value: never): never {
  throw new Error(`Unhandled chat template type: ${(value as { type: string }).type}`);
}

export function formatChatTemplateForTelegram(template: ChatTemplate): TelegramTemplateResult {
  switch (template.type) {
    case 'query-builder':
      return formatQueryBuilder(template.data);
    case 'option-selector':
      return formatOptionSelector(template.data);
    case 'waterfall-step':
      return formatWaterfallStep(template.data);
    case 'manual-position-step':
      return formatManualPositionStep(template.data);
    case 'briefing-hero':
      return formatBriefingHero(template.data);
    default:
      return assertNever(template);
  }
}

// ---------------------------------------------------------------------------
// Query Builder
// ---------------------------------------------------------------------------

function formatQueryBuilder(data: QueryBuilderTemplate): TelegramTemplateResult {
  const lines = [`\u{2728} <b>${escapeHtml(data.title)}</b>`];
  if (data.subtitle) {
    lines.push(escapeHtml(data.subtitle));
  }

  const kb = new InlineKeyboard();
  data.suggestions.forEach((s, i) => {
    const icon = iconFor(s.icon);
    const label = icon ? `${icon} ${s.label}` : s.label;
    // callback_data: "tpl:qb:<id>" — compact to stay under 64 bytes
    kb.text(label, `tpl:qb:${s.id}`);
    if (i % 2 === 1) kb.row();
  });

  return { text: lines.join('\n'), replyMarkup: kb };
}

// ---------------------------------------------------------------------------
// Option Selector
// ---------------------------------------------------------------------------

function formatOptionSelector(data: OptionSelectorTemplate): TelegramTemplateResult {
  const lines = [`<b>${escapeHtml(data.title)}</b>`];
  if (data.subtitle) {
    lines.push(escapeHtml(data.subtitle));
  }

  const kb = new InlineKeyboard();
  if (data.layout === 'grid') {
    data.options.forEach((o, i) => {
      kb.text(o.label, `tpl:os:${o.id}`);
      if (i % 2 === 1) kb.row();
    });
  } else {
    for (const o of data.options) {
      kb.text(o.label, `tpl:os:${o.id}`).row();
    }
  }

  if (data.backId) {
    kb.text('\u{2B05}\u{FE0F} Back', `tpl:os:${data.backId}`);
  }

  return { text: lines.join('\n'), replyMarkup: kb };
}

// ---------------------------------------------------------------------------
// Waterfall Step
// ---------------------------------------------------------------------------

function formatWaterfallStep(data: WaterfallStepTemplate): TelegramTemplateResult {
  const lines = [`<b>${escapeHtml(data.title)}</b>`];
  if (data.subtitle) {
    lines.push(escapeHtml(data.subtitle));
  }

  const kb = new InlineKeyboard();
  if (data.layout === 'grid') {
    data.options.forEach((o, i) => {
      kb.text(o.label, `tpl:wf:${data.flowId}:${data.stepId}:${o.id}`);
      if (i % 2 === 1) kb.row();
    });
  } else {
    for (const o of data.options) {
      kb.text(o.label, `tpl:wf:${data.flowId}:${data.stepId}:${o.id}`).row();
    }
  }

  return { text: lines.join('\n'), replyMarkup: kb };
}

// ---------------------------------------------------------------------------
// Manual Position Step
// ---------------------------------------------------------------------------

function formatManualPositionStep(data: ManualPositionStepTemplate): TelegramTemplateResult {
  const lines = [`<b>${escapeHtml(data.title)}</b>`];
  if (data.subtitle) {
    lines.push(escapeHtml(data.subtitle));
  }

  // Show filled form state as a summary
  const { formState } = data;
  const filled: string[] = [];
  if (formState.symbol) filled.push(`Symbol: <code>${escapeHtml(formState.symbol)}</code>`);
  if (formState.account) filled.push(`Account: ${escapeHtml(formState.account)}`);
  if (formState.quantity) filled.push(`Quantity: ${escapeHtml(formState.quantity)}`);
  if (formState.costBasis) filled.push(`Cost Basis: ${escapeHtml(formState.costBasis)}`);
  if (filled.length > 0) {
    lines.push('', filled.join('\n'));
  }

  const kb = new InlineKeyboard();

  if (data.presets?.length) {
    // Preset buttons (e.g. account selector)
    data.presets.forEach((preset, i) => {
      kb.text(preset, `tpl:mp:${data.step}:${preset}`);
      if (i % 2 === 1) kb.row();
    });
  }

  if (data.step === 'confirm') {
    kb.text('\u{2705} Confirm', `tpl:mp:confirm:yes`).text('\u{274C} Cancel', `tpl:mp:confirm:no`);
  }

  const hasButtons = (data.presets?.length ?? 0) > 0 || data.step === 'confirm';
  return { text: lines.join('\n'), replyMarkup: hasButtons ? kb : undefined };
}

// ---------------------------------------------------------------------------
// Briefing Hero
// ---------------------------------------------------------------------------

function formatBriefingHero(data: BriefingHeroTemplate): TelegramTemplateResult {
  const title = data.variant === 'morning' ? '\u{2600}\u{FE0F} Morning Briefing' : '\u{1F4CA} Full Briefing';
  const lines = [`<b>${title}</b> \u2014 ${escapeHtml(data.date)}`];

  if (data.updatedAt) {
    lines.push(`<i>Updated ${escapeHtml(data.updatedAt)}</i>`);
  }

  lines.push('');

  // Stats as a compact row
  const statParts = data.stats.map((s) => `<b>${escapeHtml(s.value)}</b> ${escapeHtml(s.label)}`);
  lines.push(statParts.join('  \u2022  '));

  const kb = new InlineKeyboard();
  if (data.ctaLabel && data.ctaActionId) {
    kb.text(data.ctaLabel, `tpl:bh:${data.ctaActionId}`);
  }

  return { text: lines.join('\n'), replyMarkup: data.ctaActionId ? kb : undefined };
}
