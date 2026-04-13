/**
 * Derive a Snap brief from micro insights via AI synthesis.
 *
 * Used after micro research batches complete so the user sees a snap
 * before the macro flow generates a full InsightReport. Each call
 * re-generates the snap from scratch — keeps it concise as new data arrives.
 */

import { computeSnapContentHash, snapIdFromHash } from './content-hash.js';
import type { Snap } from './types.js';
import { assetSnapsFromMicro } from './types.js';
import type { ProviderRouter } from '../ai-providers/router.js';
import type { MicroInsight } from '../insights/micro-types.js';
import { MicroInsightSourceSchema } from '../insights/micro-types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('snap-from-micro');

const SYSTEM_PROMPT = `You maintain a living portfolio snap — a TLDR of what the user needs to pay attention to across their holdings.

You will receive per-asset research notes (possibly only a subset of the portfolio that was just refreshed) and the PREVIOUS SNAP if one exists. Your job is to UPDATE the snap — merge new intel in, drop what's gone stale, keep what's still relevant. You don't see the full portfolio every cycle, so preserve previous context about assets not in the current batch.

Output:
- intelSummary: 3-5 sentences. A portfolio-wide TLDR covering the most important themes, catalysts, and risks RIGHT NOW. Cover multiple holdings — this is the user's dashboard briefing, not a single-stock blurb. Synthesize cross-portfolio themes (sector rotation, macro headwinds, correlated moves) alongside the most material per-asset catalysts.
- actionItems: UP TO 5 bullets. Concrete items the user would regret missing — earnings dates, analyst actions, regulatory deadlines, unusual moves, risk events. Each bullet covers ONE position — name the ticker and the event. Never combine unrelated positions into a single bullet.

Update rules:
- When a PREVIOUS SNAP is provided, treat it as the current state. Merge new info in, replace stale items with fresher intel, keep items that are still the most impactful. Don't rebuild from scratch.
- Replace a bullet ONLY if new information is materially more relevant (higher exposure × severity). If nothing above the noise floor changed, return the previous snap unchanged.
- When no previous snap exists, build one fresh from the asset notes provided.

Ranking: impact = weight × severity. Weight is provided per asset — use it to rank, not to mention. NEVER write weight percentages (e.g. "BTC (37.3%)", "17.5% weight"). A routine update on a large position doesn't make the cut, but a material catalyst on it does. A small position surfaces only on exceptional events (regulatory, fraud, bankruptcy risk).

Quality:
- Lead with real events/catalysts (earnings, analyst actions, regulatory, corporate, macro) — these drive price action. Technicals = supporting context, not headlines.
- Weigh materiality vs asset size. A 134-person layoff at JPM or a small contract at a $3T co is noise. Leveraged positions, liquidation levels, and short interest are noise unless they represent an extreme/historic anomaly relative to the asset's market cap.
- Cover the portfolio broadly — mention multiple tickers when they have material developments.
- Lower-quality/promotional sources weigh lower. Well-corroborated high-quality intel weighs higher.
- Skip broken-data assets ($0 prices, no signals). Don't mention data issues.
- Information-dense. No filler.

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
  const insights = [...microInsights.values()].filter(
    (mi) => mi.source === MicroInsightSourceSchema.enum.portfolio && mi.assetSnap.length > 0 && mi.conviction > 0,
  );
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
      const lines = [
        `${mi.symbol} (${mi.rating}, ${(mi.conviction * 100).toFixed(0)}% conviction${weightStr}${severityStr}):`,
        `  Thesis: ${mi.thesis}`,
      ];
      if (mi.keyDevelopments.length > 0) {
        lines.push(`  Key developments: ${mi.keyDevelopments.join('; ')}`);
      }
      if (mi.risks.length > 0) {
        lines.push(`  Risks: ${mi.risks.join('; ')}`);
      }
      if (mi.opportunities.length > 0) {
        lines.push(`  Opportunities: ${mi.opportunities.join('; ')}`);
      }
      if (mi.assetActions.length > 0) {
        lines.push(`  Observations: ${mi.assetActions.join('; ')}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');

  try {
    // Build the user message — always include previous snap so the LLM updates in place
    let userMessage = `Asset research notes (${insights.length} assets refreshed):\n\n${assetSummaries}`;

    if (previousSnap && (previousSnap.intelSummary || previousSnap.actionItems.length > 0)) {
      const prevActions =
        previousSnap.actionItems.length > 0 ? previousSnap.actionItems.map((a) => `- ${a.text}`).join('\n') : '(none)';
      userMessage +=
        `\n\n---\nPREVIOUS SNAP (generated ${previousSnap.generatedAt}):\n` +
        `Summary: ${previousSnap.intelSummary || '(none)'}\n` +
        `Actions:\n${prevActions}\n\n` +
        `Update this snap with the new research notes above. ` +
        `The research notes may only cover a subset of the portfolio — preserve previous context about assets not covered above.`;
    } else {
      userMessage += `\n\nNo previous snap exists — build a fresh one from these notes.`;
    }

    const result = await providerRouter.completeWithTools({
      model: 'sonnet',
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 1024,
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
    const actionItemTexts = Array.isArray(parsed.actionItems)
      ? (parsed.actionItems as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];

    const intelSummary = typeof parsed.intelSummary === 'string' ? parsed.intelSummary : '';
    const actionItems = actionItemTexts.map((text) => ({ text, signalIds: matchSignalIds(text, insights) }));
    const contentHash = computeSnapContentHash({ intelSummary, actionItems });

    return {
      id: snapIdFromHash(contentHash),
      generatedAt: new Date().toISOString(),
      intelSummary,
      actionItems,
      assetSnaps,
      contentHash,
    };
  } catch (err) {
    logger.warn('Snap synthesis failed — falling back to top asset snaps', { error: String(err) });

    // Fallback: stitch together top assets' snaps into a multi-asset summary
    const topInsights = sortedInsights.slice(0, 5).filter((mi) => mi.assetSnap.length > 0);
    if (topInsights.length === 0) return null;

    const intelSummary = topInsights.map((mi) => `${mi.symbol}: ${mi.assetSnap}`).join(' ');
    const actionItems = topInsights
      .flatMap((mi) => mi.assetActions.map((text) => ({ text, signalIds: mi.topSignalIds })))
      .slice(0, 5);
    const contentHash = computeSnapContentHash({ intelSummary, actionItems });

    return {
      id: snapIdFromHash(contentHash),
      generatedAt: new Date().toISOString(),
      intelSummary,
      actionItems,
      assetSnaps,
      contentHash,
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
  // Uses word-boundary matching to avoid false positives (e.g. "Open" inside "OpenAI")
  if (ids.size === 0) {
    for (const mi of insights) {
      if (mi.name && mi.name.length > 3) {
        const escaped = mi.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`\\b${escaped}\\b`, 'i').test(text)) {
          for (const id of mi.topSignalIds) ids.add(id);
        }
      }
    }
  }
  return [...ids];
}
