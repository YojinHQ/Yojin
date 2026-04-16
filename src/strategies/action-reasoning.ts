/**
 * Shared LLM reasoning for strategy → action generation.
 * Used by the Scheduler and the strategy-debug CLI.
 */

import type { Entity } from '@yojinhq/jintel-client';

import { formatTriggerContext } from './format-trigger-context.js';
import type { StrategyEvaluation } from './types.js';
import { parseVerdictFromHeadline } from '../actions/types.js';
import type { ActionVerdict } from '../actions/types.js';
import type { ProviderRouter } from '../ai-providers/router.js';
import { createSubsystemLogger } from '../logging/logger.js';
import type { Signal } from '../signals/types.js';

const logger = createSubsystemLogger('action-reasoning');

const ACTION_SYSTEM_PROMPT = `You are a trading strategist. A strategy trigger has fired. Recommend a concrete action.

Your response MUST start with a headline in this exact format:
ACTION: <BUY|SELL|REVIEW> <TICKER> — <one-sentence reason>

If (and only if) the action is SELL, add a second line sizing it as a fraction of the current position:
SIZE: SELL <N>% of position

Do NOT emit a SIZE line for BUY or REVIEW. BUY sizing is derived from the strategy's allocation budget and rendered separately — you don't need to restate it. Never quote dollar amounts, share counts, or assume cash availability.

Prefer BUY or SELL — commit to a direction when the data supports one. Use REVIEW only when the evidence is genuinely contradictory or insufficient to pick a side.

Then provide your analysis:
1. Why this trigger matters right now — reference specific news, discussions, or data points
2. Key risks before acting
3. Timing or other notes (entry/exit levels if applicable)

Be direct and concise. No disclaimers.`;

interface ActionReasoningResult {
  headline: string;
  verdict: ActionVerdict;
  reasoning: string;
  sizeGuidance?: string;
  rawOutput: string;
  fromLlm: boolean;
  parsedCleanly: boolean;
  error?: string;
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

  return `Strategy: ${evaluation.strategyName}
Trigger: ${evaluation.triggerDescription}
Ticker: ${ticker}
Trigger data: ${contextParts.join(', ')}
${formatAllocationBudget(evaluation.context)}
${entityBrief ? `\nMarket context for ${ticker}:\n${entityBrief}\n` : ''}
Strategy rules:
${evaluation.strategyContent}

Provide your ACTION headline and analysis. Reference specific news, discussions, or data points — do not speculate about what might be causing the trigger.`;
}

/** Parse headline + optional SIZE line + reasoning. SIZE is SELL-only; a missing line is not an error. */
export function parseActionResponse(
  rawOutput: string,
  evaluation: StrategyEvaluation,
): { headline: string; reasoning: string; sizeGuidance?: string; parsedCleanly: boolean } {
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

    return {
      headline,
      reasoning: rest.join('\n').trim(),
      sizeGuidance,
      parsedCleanly,
    };
  }

  return {
    headline: `REVIEW ${ticker} — ${evaluation.triggerDescription}`,
    reasoning: rawOutput,
    parsedCleanly: false,
  };
}

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
        maxTokens: 512,
      });

      const rawOutput = llmResult.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('');

      if (rawOutput) {
        const {
          headline,
          reasoning,
          sizeGuidance: llmSizeGuidance,
          parsedCleanly,
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
          sizeGuidance,
          rawOutput,
          fromLlm: true,
          parsedCleanly,
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
