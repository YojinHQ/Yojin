/**
 * Derive a Snap brief from micro insights via AI synthesis.
 *
 * Used after micro research batches complete so the user sees a snap
 * before the macro flow generates a full InsightReport. Each call
 * re-generates the snap from scratch — keeps it concise as new data arrives.
 */

import { randomUUID } from 'node:crypto';

import type { Snap } from './types.js';
import { assetSnapsFromMicro } from './types.js';
import type { ProviderRouter } from '../ai-providers/router.js';
import type { MicroInsight } from '../insights/micro-types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('snap-from-micro');

const SYSTEM_PROMPT = `You synthesize per-asset research notes into a concise portfolio snap.

Rules:
- intelSummary: 2-3 sentences MAX. What deserves attention right now across the portfolio.
- actionItems: 3-5 bullet points MAX. These are the TOP items across the entire portfolio that deserve the user's attention RIGHT NOW. They must earn their slot.
- Each action item is a neutral observation — NOT advice. Frame as "X is happening" not "do Y".
- RANK by impact = portfolio exposure × event severity. A routine update on a 30% position doesn't make the cut, but a material catalyst on that same position does. A critical event on a 2% position only makes the cut if it's truly exceptional (e.g. regulatory action, fraud, bankruptcy risk).
- The portfolio weight is provided for each asset. Use it as a multiplier, not a filter — small positions with extreme events can still surface, but they need a much higher severity to compete with large positions.
- Lead with real EVENTS and CATALYSTS — earnings, analyst actions, regulatory moves, corporate developments, macro shifts. These drive price action and are what the user needs to know first.
- Use technical indicators only as supporting evidence, never as the headline. Say "Truist cuts JPM target to $323 amid macro pressure" not "JPM RSI at 38.5 approaching oversold".
- If an asset note mentions low-quality or promotional sources, weigh it lower. Focus on well-corroborated, high-quality intelligence.
- Weigh event materiality against asset size. A minor layoff at a 300K-employee company or a small contract at a $3T company is not worth an action item. Focus on events that could meaningfully move the stock.
- Skip assets with broken data ($0 prices, no signals). Don't mention data issues.
- Be information-dense. No filler.

Respond in JSON:
{
  "intelSummary": "...",
  "actionItems": ["...", "..."]
}`;

/** Portfolio exposure per symbol — weight is fraction of total portfolio value (0–1). */
export interface PortfolioExposure {
  symbol: string;
  weight: number;
  marketValue: number;
}

/**
 * Build a Snap by AI-synthesizing micro insights into a concise brief.
 * Returns null if no usable micro insights exist.
 *
 * When portfolio exposure is provided, the synthesis prompt receives each
 * asset's weight so the LLM can prioritize high-exposure positions.
 */
export async function snapFromMicro(
  microInsights: Map<string, MicroInsight>,
  providerRouter: ProviderRouter,
  portfolioExposure?: PortfolioExposure[],
  previousSnap?: Snap | null,
): Promise<Snap | null> {
  const insights = [...microInsights.values()].filter((mi) => mi.assetSnap.length > 0 && mi.conviction > 0);
  if (insights.length === 0) return null;

  // Build exposure lookup
  const exposureMap = new Map<string, PortfolioExposure>();
  for (const e of portfolioExposure ?? []) {
    exposureMap.set(e.symbol.toUpperCase(), e);
  }

  // Build asset snaps (always included regardless of AI output)
  const assetSnaps = assetSnapsFromMicro(insights);

  // Sort by portfolio exposure first (biggest positions first), then conviction
  const sortedInsights = [...insights].sort((a, b) => {
    const expA = exposureMap.get(a.symbol.toUpperCase())?.weight ?? 0;
    const expB = exposureMap.get(b.symbol.toUpperCase())?.weight ?? 0;
    if (Math.abs(expA - expB) > 0.05) return expB - expA; // exposure dominates if gap > 5%
    return b.conviction - a.conviction;
  });

  // Build context for AI synthesis — include portfolio weight
  const assetSummaries = sortedInsights
    .map((mi) => {
      const exp = exposureMap.get(mi.symbol.toUpperCase());
      const weightStr = exp ? ` | ${(exp.weight * 100).toFixed(1)}% of portfolio` : '';
      return (
        `${mi.symbol} (${mi.rating}, ${(mi.conviction * 100).toFixed(0)}% conviction${weightStr}): ${mi.assetSnap}` +
        (mi.assetActions.length > 0 ? `\n  Observations: ${mi.assetActions.join('; ')}` : '')
      );
    })
    .join('\n');

  try {
    // Build the user message — include previous snap so the LLM can make deliberate updates
    let userMessage = `Synthesize these ${insights.length} asset research notes:\n\n${assetSummaries}`;

    if (previousSnap && previousSnap.actionItems.length > 0) {
      const prevActions = previousSnap.actionItems.map((a) => `- ${a.text}`).join('\n');
      userMessage +=
        `\n\n---\nPREVIOUS SNAP (generated ${previousSnap.generatedAt}):\n` +
        `Summary: ${previousSnap.intelSummary}\n` +
        `Actions:\n${prevActions}\n` +
        `\nUpdate the snap based on what changed. Keep actions that are still the most impactful. ` +
        `Replace only if new information is MORE relevant (higher exposure × severity). ` +
        `If nothing material changed for an asset, its action can stay.`;
    }

    const result = await providerRouter.completeWithTools({
      model: 'sonnet',
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 512,
    });

    const text = result.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('');

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('Failed to extract JSON from snap synthesis');
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const actionItems = Array.isArray(parsed.actionItems)
      ? (parsed.actionItems as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];

    return {
      id: `snap-${randomUUID().slice(0, 8)}`,
      generatedAt: new Date().toISOString(),
      intelSummary: typeof parsed.intelSummary === 'string' ? parsed.intelSummary : '',
      actionItems: actionItems.map((text) => ({ text, signalIds: matchSignalIds(text, insights) })),
      assetSnaps,
    };
  } catch (err) {
    logger.warn('Snap synthesis failed — falling back to top asset snap', { error: String(err) });

    // Fallback: use the highest-conviction asset's snap
    const top = insights[0];
    if (!top) return null;

    return {
      id: `snap-${randomUUID().slice(0, 8)}`,
      generatedAt: new Date().toISOString(),
      intelSummary: top.assetSnap,
      actionItems: top.assetActions.slice(0, 5).map((text) => ({ text, signalIds: top.topSignalIds })),
      assetSnaps,
    };
  }
}

/**
 * Match an action item's text to micro insights by ticker mention,
 * returning the union of their topSignalIds.
 * Uses word-boundary matching to avoid false positives on short tickers.
 */
function matchSignalIds(text: string, insights: MicroInsight[]): string[] {
  const upper = text.toUpperCase();
  const ids = new Set<string>();
  for (const mi of insights) {
    const escaped = mi.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?<![A-Z0-9])${escaped}(?![A-Z0-9])`).test(upper)) {
      for (const id of mi.topSignalIds) ids.add(id);
    }
  }
  // Also match by entity name if the ticker didn't match
  // (e.g. "UnitedHealth" in action text → UNH micro insight)
  if (ids.size === 0) {
    for (const mi of insights) {
      if (mi.name && mi.name.length > 3 && upper.includes(mi.name.toUpperCase())) {
        for (const id of mi.topSignalIds) ids.add(id);
      }
    }
  }
  return [...ids];
}
