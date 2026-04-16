/**
 * Shared LLM reasoning for strategy → action generation.
 *
 * Used by the Scheduler (production) and the strategy-debug CLI (eval).
 * Single source of truth for the system prompt, user message, and response parsing.
 */

import { formatTriggerContext } from './format-trigger-context.js';
import type { StrategyEvaluation } from './types.js';
import { parseVerdictFromHeadline } from '../actions/types.js';
import type { ActionVerdict } from '../actions/types.js';
import type { ProviderRouter } from '../ai-providers/router.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('action-reasoning');

// ---------------------------------------------------------------------------
// System prompt — single source of truth
// ---------------------------------------------------------------------------

export const ACTION_SYSTEM_PROMPT = `You are a trading strategist. A strategy trigger has fired. Analyze and recommend a specific action.

Your response MUST start with TWO lines in this exact format:
ACTION: <BUY|SELL|REVIEW> <TICKER> — <one-sentence reason>
SIZE: <one-line sizing clause, or "N/A" for REVIEW>

Sizing rules:
- SELL: percentage of the current position. Example: "SELL 25% of position".
- BUY with an allocation budget in context: target that allocation. Example: "BUY to 5% of portfolio (now 2.1%)".
- BUY without an allocation budget: suggest a soft cap as % of portfolio. Example: "BUY up to 2% of portfolio".
- REVIEW: use "N/A".

Never quote dollar amounts, share counts, or assume cash availability.

Then provide your analysis:
1. Why this trigger matters right now
2. Key risks before acting
3. Timing or other notes

Be direct and concise. No hedging or disclaimers.`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActionReasoningResult {
  headline: string;
  verdict: ActionVerdict;
  reasoning: string;
  /** Sizing clause parsed from the SIZE: line, or undefined when absent / N/A. */
  sizeGuidance?: string;
  rawOutput: string;
  /** Whether the LLM produced the result (vs static fallback). */
  fromLlm: boolean;
  /** Whether the LLM output matched the expected ACTION: format (false = parse fell back to REVIEW). */
  parsedCleanly: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format allocation budget info for the LLM prompt when the strategy has a targetAllocation. */
export function formatAllocationBudget(context: Record<string, unknown>): string {
  const target = context.targetAllocation as number | undefined;
  if (target == null) return '';
  const actual = (context.actualAllocation as number | undefined) ?? 0;
  const remaining = (context.allocationRemaining as number | undefined) ?? Math.max(0, target - actual);
  return `\nAllocation budget: target ${(target * 100).toFixed(0)}% of portfolio, current ${(actual * 100).toFixed(1)}%, remaining ${(remaining * 100).toFixed(1)}%\n`;
}

/** Build the user message sent to the LLM for a single evaluation. */
export function buildUserMessage(evaluation: StrategyEvaluation): string {
  const ticker = (evaluation.context.ticker as string | undefined) ?? 'portfolio-wide';
  const contextParts = formatTriggerContext(evaluation.context);

  return `Strategy: ${evaluation.strategyName}
Trigger: ${evaluation.triggerDescription}
Ticker: ${ticker}
Trigger data: ${contextParts.join(', ')}
${formatAllocationBudget(evaluation.context)}
Strategy rules:
${evaluation.strategyContent}

Provide your ACTION headline and analysis.`;
}

/** Parse the LLM response into headline + optional SIZE: + reasoning. */
export function parseActionResponse(
  rawOutput: string,
  evaluation: StrategyEvaluation,
): { headline: string; reasoning: string; sizeGuidance?: string; parsedCleanly: boolean } {
  const ticker = (evaluation.context.ticker as string | undefined) ?? 'portfolio';

  const lines = rawOutput.split('\n').filter(Boolean);
  const actionMatch = lines[0]?.match(/^ACTION:\s*(.+)/i);

  if (actionMatch) {
    const sizeMatch = lines[1]?.match(/^SIZE:\s*(.+)/i);
    const rest = sizeMatch ? lines.slice(2) : lines.slice(1);
    const sizeRaw = sizeMatch?.[1].trim();
    const sizeGuidance = sizeRaw && sizeRaw.toUpperCase() !== 'N/A' ? sizeRaw : undefined;
    return {
      headline: actionMatch[1].trim(),
      reasoning: rest.join('\n').trim(),
      sizeGuidance,
      parsedCleanly: true,
    };
  }

  // Fallback when LLM didn't produce structured output
  return {
    headline: `REVIEW ${ticker} — ${evaluation.triggerDescription}`,
    reasoning: rawOutput,
    parsedCleanly: false,
  };
}

// ---------------------------------------------------------------------------
// Main reasoning function
// ---------------------------------------------------------------------------

/**
 * Generate an action recommendation for a single strategy evaluation.
 *
 * Calls the LLM with the standard strategist prompt and parses the response.
 * Falls back to a static REVIEW headline when the LLM is unavailable.
 */
export async function generateActionReasoning(
  evaluation: StrategyEvaluation,
  providerRouter: ProviderRouter | null,
): Promise<ActionReasoningResult> {
  const ticker = (evaluation.context.ticker as string | undefined) ?? 'portfolio';

  if (!providerRouter) {
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
        messages: [{ role: 'user', content: buildUserMessage(evaluation) }],
        maxTokens: 512,
      });

      const rawOutput = llmResult.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('');

      if (rawOutput) {
        const { headline, reasoning, sizeGuidance, parsedCleanly } = parseActionResponse(rawOutput, evaluation);
        const finalHeadline = headline || `REVIEW ${ticker} — ${evaluation.triggerDescription}`;
        const finalReasoning = reasoning || evaluation.triggerDescription;

        if (!parsedCleanly) {
          logger.warn('LLM response did not match ACTION: format, falling back to REVIEW', {
            strategyId: evaluation.strategyId,
            ticker,
            firstLine: rawOutput.split('\n')[0]?.slice(0, 120),
          });
        } else {
          logger.info('LLM reasoning generated for strategy trigger', {
            strategyId: evaluation.strategyId,
            ticker,
            headline: finalHeadline,
          });
        }

        return {
          headline: finalHeadline,
          verdict: parseVerdictFromHeadline(finalHeadline),
          reasoning: finalReasoning,
          sizeGuidance,
          rawOutput,
          fromLlm: true,
          parsedCleanly,
        };
      }
    } catch (err) {
      logger.warn('LLM reasoning failed for strategy trigger, using static content', {
        strategyId: evaluation.strategyId,
        error: err instanceof Error ? err.message : String(err),
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
  };
}
