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

const SYSTEM_PROMPT = `You synthesize per-asset research into a short portfolio snap.

Output:
- intelSummary: 1-2 sentences MAX. The single most important portfolio-level theme right now. Not a list. Not per-ticker — that's the Actions card's job.
- actionItems: UP TO 3 bullets. Only the items the user would regret missing. Fewer is better than more. If nothing rises above the noise, return an empty array.

Ranking: impact = weight × severity. Weight is provided per asset — use it to rank, not to mention. NEVER write weight percentages (e.g. "BTC (37.3%)", "17.5% weight"). A routine update on a large position doesn't make the cut, but a material catalyst on it does. A small position surfaces only on exceptional events (regulatory, fraud, bankruptcy risk).

Rules:
- Lead with real events/catalysts (earnings, analyst actions, regulatory, corporate, macro) — these drive price action. Technicals = supporting context, not headlines. Say "Truist cuts JPM target to $323" not "JPM RSI 38.5".
- Weigh materiality vs asset size. Focus on events that could meaningfully move the stock. A 134-person layoff at JPM or a small contract at a $3T co is noise.
- Do NOT repeat per-ticker observations that the Actions card already surfaces. The snap is PORTFOLIO-level synthesis (themes, correlations, regime shifts), not a catalogue of per-asset events.
- Lower-quality/promotional sources weigh lower. Well-corroborated high-quality intel weighs higher.
- Skip broken-data assets ($0 prices, no signals). Don't mention data issues.
- Information-dense. No filler. Brevity over completeness.

Respond in JSON: { "intelSummary": "...", "actionItems": ["..."] }`;

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

  // Build context for AI synthesis — include portfolio weight AND per-asset
  // severity so the model has the raw inputs for its exposure × severity
  // ranking. Without an explicit severity value the model would have to infer
  // priority from prose, which weakens the supersede heuristic.
  const assetSummaries = sortedInsights
    .map((mi) => {
      const exp = exposureMap.get(mi.symbol.toUpperCase());
      const weightStr = exp ? ` | ${(exp.weight * 100).toFixed(1)}% of portfolio` : '';
      const severityStr = typeof mi.severity === 'number' ? ` | severity ${mi.severity.toFixed(2)}` : '';
      return (
        `${mi.symbol} (${mi.rating}, ${(mi.conviction * 100).toFixed(0)}% conviction${weightStr}${severityStr}): ${mi.assetSnap}` +
        (mi.assetActions.length > 0 ? `\n  Observations: ${mi.assetActions.join('; ')}` : '')
      );
    })
    .join('\n');

  try {
    // Build the user message — include previous snap so the LLM can make deliberate updates
    let userMessage = `Synthesize these ${insights.length} asset research notes:\n\n${assetSummaries}`;

    if (previousSnap && (previousSnap.intelSummary || previousSnap.actionItems.length > 0)) {
      const prevActions =
        previousSnap.actionItems.length > 0 ? previousSnap.actionItems.map((a) => `- ${a.text}`).join('\n') : '(none)';
      userMessage +=
        `\n\n---\nPREVIOUS SNAP (generated ${previousSnap.generatedAt}):\n` +
        `Summary: ${previousSnap.intelSummary || '(none)'}\n` +
        `Actions:\n${prevActions}\n\n` +
        `UPDATE the snap in place — don't rebuild it from scratch. Keep bullets that are still the most impactful. ` +
        `Replace a bullet ONLY if new information is materially more relevant (higher exposure × severity). ` +
        `If nothing above the noise floor changed, it is perfectly fine to return the previous snap unchanged. ` +
        `The goal is a stable, short brief that evolves with events — NOT a fresh synthesis every cycle.`;
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
