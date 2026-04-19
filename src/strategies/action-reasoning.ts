/**
 * Shared LLM reasoning for strategy → action generation.
 * Used by the Scheduler and the strategy-debug CLI.
 */

import type { Entity } from '@yojinhq/jintel-client';

import { formatTriggerContext } from './format-trigger-context.js';
import type { StrategyEvaluation } from './types.js';
import { ConvictionLevelSchema, parseVerdictFromHeadline } from '../actions/types.js';
import type { ActionVerdict, ConvictionLevel } from '../actions/types.js';
import type { ProviderRouter } from '../ai-providers/router.js';
import { createSubsystemLogger } from '../logging/logger.js';
import type { Signal } from '../signals/types.js';

const logger = createSubsystemLogger('action-reasoning');

const ACTION_SYSTEM_PROMPT = `You are Yojin. A strategy trigger fired — text a friend who trades. Not an analyst brief.

## Headline (exact format, required)
ACTION: <BUY|SELL|REVIEW> <TICKER> — <catalyst, max 6 words AND 50 chars>

The catalyst is the specific event that makes this actionable now. Compress aggressively: "Pentagon AI deal signed" not "Alphabet explores Pentagon AI deal, accelerating AI defense strategy". No ticker/verdict in the catalyst (they're in the prefix). No trigger metrics in the headline (rendered separately).

If and only if SELL, add:
SIZE: SELL <N>% of position

No SIZE for BUY (derived from allocation budget) or REVIEW. Never quote dollar amounts, share counts, or assume cash availability.

Prefer BUY or SELL — commit when the data supports one. REVIEW only when evidence is genuinely split.

## Structured params (one per line)
ENTRY: <price or range, e.g. "$245-250" or "at market">
TARGET: <target price>
STOP: <stop loss price>
HORIZON: <e.g. "1-2 weeks", "intraday">
CONVICTION: <LOW|MEDIUM|HIGH>
MAX_ENTRY: <BUY: ceiling; SELL: floor — beyond this the catalyst is priced in. Use the price context and your catalyst impact estimate to set this.>
CATALYST_IMPACT: <e.g. "3-5%", "~8% upside">
SUMMARY: <STRICT max 90 chars — count every character. Catalyst + why-now in one compressed sentence. No metrics, no dollars, no numbers, no time windows, no ticker, no "act within Xh" phrasing.>

SUMMARY examples — GOOD (under 90 chars):
- "Social momentum signals crowd rotation into gold as safe-haven." (65)
- "Pentagon AI deal validates defense revenue thesis." (51)

SUMMARY examples — BAD:
- "Sharp social sentiment momentum on GLD signals crowd rotation into gold as a safe-haven; act within 2-hour entry window before signal fades." (140 — ticker, timing, filler adjectives)
- "FCC greenlight on Amazon-Globalstar deal + Altimeter's $511M stake add are driving fresh bullish social momentum — act within the 2-hour window." (145 — dollar amount, timing)

Count SUMMARY chars before emitting. Over 90 → rewrite shorter.

## Understand the signal before you publish it
Real people read this and act on it. Before you write, read the signal context carefully — don't parrot narrative framing from a headline. Headlines compress, misstate, and sometimes invert the story.

Cross-check before committing to a direction:
- Does the catalyst match the price action? If equities and your asset move the same way, the "divergence" story might be invented.
- Does the news body actually agree with its own headline?
- Is the cause-and-effect story you're telling supported by the data, or are you filling in connective tissue?
- Is the underlying fact itself verified, or just asserted by one source?

If the signal has internal contradictions, thin evidence, or an ambiguous underlying fact — say so. "Chatter is spiking, cause unclear" beats a confident wrong narrative. When the data doesn't support a clean direction, use REVIEW instead of forcing BUY or SELL.

## Reasoning — text, not brief
After the params, write 2-3 short paragraphs. Conversational, specific, opinionated. NOT sectioned, NOT bulleted, NOT analyst prose.

Cover in flowing text (no headers):
- What fired and why it matters. Point at the specific news/data — not a paraphrase of the trigger.
- Whether price is nodding along or fighting it.
- The main way this blows up. One or two concrete caveats, embedded in sentences.
- Optional closer as a fragment: "Small size, tight stop."

Always end with this exact line on its own:
Not financial advice — your call.

## Hard rules
- No markdown headers (##, ###). No bullets in the reasoning body.
- No filler: "it is worth noting", "importantly", "however", "that said", "in summary", "overall", "as such", "given that", "ultimately".
- No hedges: "potentially", "arguably", "somewhat", "relatively", "fairly", "quite".
- No intensifiers: "sharply", "significantly", "substantially", "notably", "markedly" — just state the move.
- No urgency theater ("act within 2h").
- Don't restate the ticker, verdict, ENTRY/TARGET/STOP/HORIZON/CATALYST_IMPACT, or trigger metrics — they render separately.
- Cut any sentence that doesn't add information.
- Mild swearing OK when it fits. Don't force it.

## Voice reference (tone only — do NOT reuse these facts)
Azure printed 35% vs. 30% consensus and the AI line got its own breakout on the call. Street expected cooling, got the opposite — that's the setup.

Price popped 6% after-hours, so a chunk of it is already in. Guide wasn't heroic either; capex got pulled forward, which hits margins for two quarters before revenue catches up. That's the obvious unwind risk.

Wait for the pullback. Not at $412.

Not financial advice — your call.`;

interface ActionReasoningResult {
  headline: string;
  verdict: ActionVerdict;
  reasoning: string;
  summary?: string;
  sizeGuidance?: string;
  rawOutput: string;
  fromLlm: boolean;
  parsedCleanly: boolean;
  error?: string;
  /** LLM-suggested entry range, e.g. "$245-250" or "at market". */
  entryRange?: string;
  /** LLM-suggested target exit price. */
  targetPrice?: number;
  /** LLM-suggested stop loss price. */
  stopLoss?: number;
  /** Time horizon, e.g. "1-2 weeks". */
  horizon?: string;
  /** LLM's conviction level. */
  conviction?: ConvictionLevel;
  /** Price ceiling (BUY) or floor (SELL) beyond which the catalyst is priced in. */
  maxEntry?: number;
  /** LLM-estimated catalyst impact, e.g. "3-5%". */
  catalystImpact?: string;
}

interface ActionEntityContext {
  entity: Entity;
  signals: Signal[];
}

interface PositionSizing {
  currentPrice: number;
  suggestedQuantity: number;
  suggestedValue: number;
}

export function formatAllocationBudget(context: Record<string, unknown>): string {
  const target = context.targetAllocation as number | undefined;
  if (target == null) return '';
  const actual = (context.actualAllocation as number | undefined) ?? 0;
  const remaining = (context.allocationRemaining as number | undefined) ?? Math.max(0, target - actual);
  return `\nAllocation budget: target ${(target * 100).toFixed(0)}% of portfolio, current ${(actual * 100).toFixed(1)}%, remaining ${(remaining * 100).toFixed(1)}%\n`;
}

/** Deterministic sizing text for BUY actions, derived from strategy allocation context. */
export function formatBuySizeGuidance(context: Record<string, unknown>): string | undefined {
  const target = context.targetAllocation as number | undefined;
  if (target != null) {
    const actual = (context.actualAllocation as number | undefined) ?? 0;
    return `BUY to ${(target * 100).toFixed(0)}% of portfolio (now ${(actual * 100).toFixed(1)}%)`;
  }
  const maxPosition = context.maxPositionSize as number | undefined;
  if (maxPosition != null) {
    return `BUY up to ${(maxPosition * 100).toFixed(0)}% of portfolio`;
  }
  return undefined;
}

/** Deterministic BUY-to-target sizing. Returns null when allocation data or price is missing. */
export function computePositionSizing(
  context: Record<string, unknown>,
  currentPrice: number | undefined,
  totalPortfolioValue: number | undefined,
): PositionSizing | null {
  if (!currentPrice || !totalPortfolioValue || totalPortfolioValue <= 0) return null;

  const target = context.targetAllocation as number | undefined;
  const actual = (context.actualAllocation as number | undefined) ?? 0;
  const maxPosition = context.maxPositionSize as number | undefined;

  let allocationFraction: number;
  if (target != null) {
    allocationFraction = Math.max(0, target - actual);
  } else if (maxPosition != null) {
    allocationFraction = Math.max(0, maxPosition - actual);
  } else {
    return null;
  }

  const suggestedValue = allocationFraction * totalPortfolioValue;
  if (suggestedValue <= 0) return null;

  const suggestedQuantity = Math.floor(suggestedValue / currentPrice);
  if (suggestedQuantity <= 0) return null;

  return { currentPrice, suggestedQuantity, suggestedValue };
}

/** Format price context from the Jintel quote so the LLM can assess whether the move already happened. */
function formatPriceContext(entity: Entity): string {
  const quote = entity.market?.quote;
  if (!quote) return '';

  const parts: string[] = [];
  parts.push(`Current price: $${quote.price.toFixed(2)}`);

  if (quote.previousClose != null) {
    parts.push(`Previous close: $${quote.previousClose.toFixed(2)}`);
    const changePct = ((quote.price - quote.previousClose) / quote.previousClose) * 100;
    parts.push(`Change from close: ${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`);
  }

  if (quote.preMarketPrice != null) {
    parts.push(`Pre-market price: $${quote.preMarketPrice.toFixed(2)}`);
    if (quote.preMarketChangePercent != null) {
      parts.push(
        `Pre-market change: ${quote.preMarketChangePercent >= 0 ? '+' : ''}${quote.preMarketChangePercent.toFixed(2)}%`,
      );
    }
  }

  if (quote.postMarketPrice != null) {
    parts.push(`Post-market price: $${quote.postMarketPrice.toFixed(2)}`);
    if (quote.postMarketChangePercent != null) {
      parts.push(
        `Post-market change: ${quote.postMarketChangePercent >= 0 ? '+' : ''}${quote.postMarketChangePercent.toFixed(2)}%`,
      );
    }
  }

  if (quote.open != null) {
    parts.push(`Today's open: $${quote.open.toFixed(2)}`);
  }

  return parts.join('\n');
}

function formatEntityBrief(ctx: ActionEntityContext): string {
  const sections: string[] = [];

  const news = ctx.entity.news;
  if (news?.length) {
    const lines = news.slice(0, 10).map((n) => {
      const sentiment =
        n.sentimentScore != null
          ? ` [sentiment: ${n.sentimentScore > 0 ? '+' : ''}${n.sentimentScore.toFixed(2)}]`
          : '';
      return `- [${n.source}] ${n.title}${sentiment}${n.date ? ` (${n.date})` : ''}`;
    });
    sections.push(`Recent news:\n${lines.join('\n')}`);
  }

  const social = ctx.entity.social;
  if (social?.reddit?.length) {
    const posts = social.reddit
      .slice(0, 8)
      .map((p) => `- r/${p.subreddit}: ${p.title} (score: ${p.score}, comments: ${p.numComments})`);
    sections.push(`Reddit discussions:\n${posts.join('\n')}`);
  }

  const s = ctx.entity.sentiment;
  if (s) {
    const rankDelta = s.rank24hAgo - s.rank;
    const rankDir = rankDelta > 0 ? `↑${rankDelta}` : rankDelta < 0 ? `↓${Math.abs(rankDelta)}` : '→';
    const mentionDelta = s.mentions - s.mentions24hAgo;
    const mentionDir = mentionDelta > 0 ? `+${mentionDelta}` : `${mentionDelta}`;
    sections.push(
      `Social sentiment: rank #${s.rank} (${rankDir} 24h) | mentions: ${s.mentions} (${mentionDir}) | upvotes: ${s.upvotes}`,
    );
  }

  const research = ctx.entity.research;
  if (research?.length) {
    const lines = research
      .slice(0, 5)
      .map((r) => `- ${r.title}${r.author ? ` — ${r.author}` : ''}${r.publishedDate ? ` (${r.publishedDate})` : ''}`);
    sections.push(`Research:\n${lines.join('\n')}`);
  }

  const recentSignals = ctx.signals
    .filter((sig) => sig.tier1 || sig.title)
    .slice(0, 8)
    .map((sig) => `- [${sig.type}] ${sig.title}${sig.tier1 ? `: ${sig.tier1}` : ''}`);
  if (recentSignals.length) {
    sections.push(`Recent signals:\n${recentSignals.join('\n')}`);
  }

  return sections.join('\n\n');
}

function buildUserMessage(evaluation: StrategyEvaluation, entityContext?: ActionEntityContext): string {
  const ticker = (evaluation.context.ticker as string | undefined) ?? 'portfolio-wide';
  const contextParts = formatTriggerContext(evaluation.context);

  const entityBrief = entityContext ? formatEntityBrief(entityContext) : '';
  const priceCtx = entityContext ? formatPriceContext(entityContext.entity) : '';

  return `Strategy: ${evaluation.strategyName}
Trigger: ${evaluation.triggerDescription}
Ticker: ${ticker}
Trigger data: ${contextParts.join(', ')}
${formatAllocationBudget(evaluation.context)}
${priceCtx ? `\nPrice context:\n${priceCtx}\n` : ''}
${entityBrief ? `\nMarket context for ${ticker}:\n${entityBrief}\n` : ''}
Strategy rules:
${evaluation.strategyContent}

Provide your ACTION headline and analysis. Reference specific news, discussions, or data points — do not speculate about what might be causing the trigger.`;
}

// ---------------------------------------------------------------------------
// Structured parameter parsing
// ---------------------------------------------------------------------------

/** Regex for structured parameter lines — used to filter them out of reasoning text. */
const PARAM_LINE_RE = /^(ENTRY|TARGET|STOP|HORIZON|CONVICTION|MAX_ENTRY|CATALYST_IMPACT|SUMMARY):/i;

/** Max summary length that reliably fits the 3-line Intel Feed action card. */
const SUMMARY_MAX_CHARS = 140;

/** Clamp an LLM-emitted summary to fit the compact action card without truncation. */
function clampSummary(summary: string): string {
  if (summary.length <= SUMMARY_MAX_CHARS) return summary;
  const cut = summary.slice(0, SUMMARY_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  const safe = lastSpace > 80 ? cut.slice(0, lastSpace) : cut;
  return safe.replace(/[,\s]+$/, '') + '…';
}

/** Valid conviction values for clamping LLM output. */
const VALID_CONVICTIONS: Set<string> = new Set(ConvictionLevelSchema.options);

export interface StructuredParams {
  entryRange?: string;
  targetPrice?: number;
  stopLoss?: number;
  horizon?: string;
  conviction?: ConvictionLevel;
  /** Price ceiling (BUY) or floor (SELL) beyond which the catalyst is priced in. */
  maxEntry?: number;
  /** LLM-estimated catalyst impact, e.g. "3-5%". */
  catalystImpact?: string;
  /** 1-2 sentence condensed summary for compact UI cards. */
  summary?: string;
}

/** Parse structured trading parameters from LLM output lines. Each field parsed independently. */
export function parseStructuredParams(lines: string[]): StructuredParams {
  const result: StructuredParams = {};

  for (const line of lines) {
    const trimmed = line.trim();

    const entryMatch = trimmed.match(/^ENTRY:\s*(.+)/i);
    if (entryMatch) {
      result.entryRange = entryMatch[1].trim();
      continue;
    }

    const targetMatch = trimmed.match(/^TARGET:\s*\$?([\d,.]+)/i);
    if (targetMatch) {
      const val = parseFloat(targetMatch[1].replace(/,/g, ''));
      if (Number.isFinite(val) && val > 0) result.targetPrice = val;
      continue;
    }

    const stopMatch = trimmed.match(/^STOP:\s*\$?([\d,.]+)/i);
    if (stopMatch) {
      const val = parseFloat(stopMatch[1].replace(/,/g, ''));
      if (Number.isFinite(val) && val > 0) result.stopLoss = val;
      continue;
    }

    const horizonMatch = trimmed.match(/^HORIZON:\s*(.+)/i);
    if (horizonMatch) {
      result.horizon = horizonMatch[1].trim();
      continue;
    }

    const convictionMatch = trimmed.match(/^CONVICTION:\s*(\w+)/i);
    if (convictionMatch) {
      const val = convictionMatch[1].toUpperCase();
      if (VALID_CONVICTIONS.has(val)) {
        result.conviction = val as ConvictionLevel;
      }
      continue;
    }

    const maxEntryMatch = trimmed.match(/^MAX_ENTRY:\s*\$?([\d,.]+)/i);
    if (maxEntryMatch) {
      const val = parseFloat(maxEntryMatch[1].replace(/,/g, ''));
      if (Number.isFinite(val) && val > 0) result.maxEntry = val;
      continue;
    }

    const catalystMatch = trimmed.match(/^CATALYST_IMPACT:\s*(.+)/i);
    if (catalystMatch) {
      result.catalystImpact = catalystMatch[1].trim();
      continue;
    }

    const summaryMatch = trimmed.match(/^SUMMARY:\s*(.+)/i);
    if (summaryMatch) {
      result.summary = clampSummary(summaryMatch[1].trim());
      continue;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/** Parse headline + optional SIZE line + structured params + reasoning. */
export function parseActionResponse(
  rawOutput: string,
  evaluation: StrategyEvaluation,
): { headline: string; reasoning: string; sizeGuidance?: string; parsedCleanly: boolean } & StructuredParams {
  const ticker = (evaluation.context.ticker as string | undefined) ?? 'portfolio';

  const lines = rawOutput.split('\n').filter(Boolean);
  const actionIdx = lines.findIndex((l) => /^ACTION:\s*.+/i.test(l));

  if (actionIdx >= 0) {
    const headline = lines[actionIdx].replace(/^ACTION:\s*/i, '').trim();
    const sizeMatch = lines[actionIdx + 1]?.match(/^SIZE:\s*(.+)/i);
    const rest = sizeMatch ? lines.slice(actionIdx + 2) : lines.slice(actionIdx + 1);
    const sizeRaw = sizeMatch?.[1].trim();
    const sizeGuidance = sizeRaw && sizeRaw.toUpperCase() !== 'N/A' ? sizeRaw : undefined;

    const verdict = parseVerdictFromHeadline(headline);
    const parsedCleanly = verdict !== 'SELL' || sizeGuidance != null;

    const params = parseStructuredParams(rest);
    const reasoningLines = rest.filter((l) => !PARAM_LINE_RE.test(l.trim()));

    return {
      headline,
      reasoning: reasoningLines.join('\n').trim(),
      sizeGuidance,
      parsedCleanly,
      ...params,
    };
  }

  const params = parseStructuredParams(lines);
  return {
    headline: `REVIEW ${ticker} — ${evaluation.triggerDescription}`,
    reasoning: rawOutput,
    parsedCleanly: false,
    ...params,
  };
}

// ---------------------------------------------------------------------------
// Main reasoning function
// ---------------------------------------------------------------------------

/** Run the strategist prompt for one evaluation. Falls back to a static REVIEW when the LLM is unavailable. */
export async function generateActionReasoning(
  evaluation: StrategyEvaluation,
  providerRouter: ProviderRouter | null,
  entityContext?: ActionEntityContext,
): Promise<ActionReasoningResult> {
  const ticker = (evaluation.context.ticker as string | undefined) ?? 'portfolio';

  let error: string | undefined;

  if (!providerRouter) {
    error = 'LLM provider not configured';
    logger.warn('LLM provider unavailable for action reasoning', {
      strategyId: evaluation.strategyId,
      ticker,
    });
  } else {
    logger.info('Requesting LLM reasoning for strategy trigger', {
      strategyId: evaluation.strategyId,
      ticker,
    });
    try {
      const llmResult = await providerRouter.completeWithTools({
        model: 'sonnet',
        system: ACTION_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserMessage(evaluation, entityContext) }],
        maxTokens: 600,
      });

      const rawOutput = llmResult.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('');

      if (rawOutput) {
        const {
          headline,
          reasoning,
          summary,
          sizeGuidance: llmSizeGuidance,
          parsedCleanly,
          entryRange,
          targetPrice,
          stopLoss,
          horizon,
          conviction,
          maxEntry,
          catalystImpact,
        } = parseActionResponse(rawOutput, evaluation);
        const finalHeadline = headline || `REVIEW ${ticker} — ${evaluation.triggerDescription}`;
        const finalReasoning = reasoning || evaluation.triggerDescription;
        const verdict = parseVerdictFromHeadline(finalHeadline);

        // BUY sizing is deterministic; SELL sizing comes from the LLM; REVIEW has none.
        const sizeGuidance =
          verdict === 'BUY'
            ? formatBuySizeGuidance(evaluation.context)
            : verdict === 'SELL'
              ? llmSizeGuidance
              : undefined;

        if (parsedCleanly) {
          logger.info('LLM reasoning generated for strategy trigger', {
            strategyId: evaluation.strategyId,
            ticker,
            headline: finalHeadline,
          });
        }

        return {
          headline: finalHeadline,
          verdict,
          reasoning: finalReasoning,
          summary,
          sizeGuidance,
          rawOutput,
          fromLlm: true,
          parsedCleanly,
          entryRange,
          targetPrice,
          stopLoss,
          horizon,
          conviction,
          maxEntry,
          catalystImpact,
        };
      }
      error = 'Empty LLM response';
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      logger.warn('LLM reasoning failed for strategy trigger, using static content', {
        strategyId: evaluation.strategyId,
        error,
      });
    }
  }

  const headline = `REVIEW ${ticker} — ${evaluation.triggerDescription}`;
  return {
    headline,
    verdict: parseVerdictFromHeadline(headline),
    reasoning: evaluation.triggerDescription,
    rawOutput: '',
    fromLlm: false,
    parsedCleanly: false,
    error,
  };
}

/**
 * Deterministic priced-in check: has the current price already moved past the
 * LLM's max entry threshold?
 * - BUY: priced in if currentPrice > maxEntry (stock already above ceiling)
 * - SELL: priced in if currentPrice < maxEntry (stock already below floor)
 * Returns `undefined` when data is insufficient to determine.
 */
export function checkPricedIn(
  verdict: ActionVerdict,
  currentPrice: number | undefined,
  maxEntry: number | undefined,
): boolean | undefined {
  if (currentPrice == null || maxEntry == null) return undefined;
  if (verdict === 'BUY') return currentPrice > maxEntry;
  if (verdict === 'SELL') return currentPrice < maxEntry;
  return undefined;
}
