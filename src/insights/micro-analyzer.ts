/**
 * Micro Analyzer — single Sonnet LLM call per asset.
 *
 * Takes a pre-built DataBrief and produces a MicroInsight via a direct
 * ProviderRouter call (no agent loop, no orchestrator overhead).
 *
 * Output is strictly observational — no advice, no recommendations.
 */

import { randomUUID } from 'node:crypto';

import type { DataBrief } from './data-gatherer.js';
import { formatBriefsForContext } from './data-gatherer.js';
import { MicroInsightSchema } from './micro-types.js';
import type { MicroInsight, MicroInsightSource } from './micro-types.js';
import type { ProviderRouter } from '../ai-providers/router.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('micro-analyzer');

const SYSTEM_PROMPT = `You are a neutral market observer. Summarize what is happening with the provided asset based strictly on the data. Do NOT give advice, opinions, or recommendations. Do NOT use terms like "buy", "sell", "hold", "recommend", or "should". Your job is to surface facts and observations so the user can draw their own conclusions.

Output ONLY valid JSON matching this schema:
{
  "rating": "VERY_BULLISH" | "BULLISH" | "NEUTRAL" | "BEARISH" | "VERY_BEARISH",
  "conviction": 0.0-1.0,
  "severity": 0.0-1.0,
  "thesis": "2-3 sentence factual summary of what is happening with this asset",
  "keyDevelopments": ["up to 3 notable recent developments — facts only"],
  "risks": ["up to 3 observed risk factors"],
  "opportunities": ["up to 3 observed positive factors"],
  "sentiment": "BULLISH" | "BEARISH" | "MIXED" | "NEUTRAL",
  "assetSnap": "1 sentence: the single most notable observation about this asset right now",
  "assetActions": ["1-3 bullet-point summaries of the key NEWS and EVENTS for this asset. Focus on real-world catalysts: earnings, analyst actions, deals, regulatory moves, corporate developments. NEVER include technical indicators (RSI, MACD, Bollinger Bands, moving averages) — those belong in the analysis, not in actions. NEVER include meta-commentary about data quality or dataset gaps. If there are no real events, return a single item summarizing the most notable factual observation. Always include at least 1 item."]
}

Severity calibration (the priority score for this observation — controls whether it surfaces as an Action and supersedes older ones for the same ticker):
- 0.90–1.00  Critical: earnings beat/miss, guidance change, M&A, regulatory bombshell, major analyst upgrade/downgrade, 5%+ move on confirmed catalyst
- 0.70–0.89  High: notable fundamental or sentiment shift, credible rumor, meaningful analyst price-target change, material contract/partnership
- 0.40–0.69  Medium: incremental news, small analyst note, sector-wide move spilling over, mixed signals worth flagging
- 0.10–0.39  Low: routine coverage, minor technical setup, quiet consolidation
- 0.00–0.09  Noise: nothing material; only a boring factual observation to satisfy assetActions

Severity should reflect the ACTUAL observation, not the rating. A "VERY_BEARISH" rating on a tiny, already-priced-in headline is still low severity. A "NEUTRAL" rating on a major but ambiguous catalyst (e.g. pending regulatory ruling) can be mid-to-high severity — the user wants to know it's happening even if direction is unclear.

Rules:
- Base your analysis ONLY on the provided data. Do not hallucinate.
- NEVER give directional advice. State what IS happening, not what the user should DO.
- Rating and sentiment reflect observed market conditions, not your recommendation.

Data quality — think critically:
- Financial news providers (Yahoo, SeekingAlpha, Motley Fool, InvestorPlace, etc.) mix real journalism with paid promotional content. Don't treat all articles equally.
- Paid/promotional articles often: ask questions as headlines ("Is X a buy?"), list "top stocks to buy", restate price data without news, or hype without substance.
- Look THROUGH the noise to find the real insight. What actually happened? An earnings beat, a regulatory filing, an analyst action, a supply chain disruption — that's the signal. A listicle saying "3 stocks to buy now" is not.
- When multiple articles say the same thing, that's corroboration. When only one low-quality source reports something, lower your conviction.
- Research reports with specific data points and analysis are higher quality than news aggregation.

Materiality — size matters:
- Always weigh event magnitude against asset size. A $50M contract is transformative for a $2B company but irrelevant for a $3T one. A 134-person layoff at JPMorgan (300K+ employees) is a rounding error, not a development.
- Use market cap (provided in the data) as your reference. If the event value is <0.5% of market cap, it's likely noise unless it signals a trend.
- Analyst price target changes matter more when the gap between current price and target is significant relative to the stock price.
- Prioritize events that could move the stock by 2%+ over events that are factually true but immaterial.

Content priorities:
- Lead with the most impactful narrative — real events, earnings, analyst actions, corporate developments, macro shifts. Use technicals as supporting context, not the headline.
- assetActions must be NEWS and EVENTS only. Say "Truist cuts price target to $323 amid macro headwinds" not "RSI at 38.5 approaching oversold". Never put technical indicators, Bollinger Bands, MACD, RSI, or moving averages in assetActions.
- Never put meta-commentary about data quality in assetActions. "No fund-level catalyst in dataset" is not an action — skip it.
- If all available data is low-quality promotional content, say so in the thesis and lower conviction accordingly.
- Be concise. Every field should be information-dense.`;

interface AnalyzeTickerOptions {
  source: MicroInsightSource;
}

export async function analyzeTicker(
  brief: DataBrief,
  providerRouter: ProviderRouter,
  options: AnalyzeTickerOptions,
): Promise<MicroInsight> {
  const start = Date.now();
  const briefText = formatBriefsForContext([brief]);

  const result = await providerRouter.completeWithTools({
    model: 'sonnet',
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Analyze ${brief.symbol} (${brief.name}):\n\n${briefText}` }],
    maxTokens: 1024,
  });

  const text = result.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const durationMs = Date.now() - start;

  // Parse LLM JSON output
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON object found in response');
    const parsed: unknown = JSON.parse(jsonMatch[0]);
    const analysis = parsed as Record<string, unknown>;

    // Clamp severity to [0, 1] before schema validation. The LLM occasionally
    // emits values slightly outside the ladder (e.g. 1.05, -0.02); those would
    // fail `MicroInsightSchema.parse()` and drop the whole insight to the
    // fallback path, losing an otherwise-valid analysis.
    const rawSeverity = typeof analysis.severity === 'number' ? analysis.severity : undefined;
    const severity =
      rawSeverity !== undefined && Number.isFinite(rawSeverity) ? Math.max(0, Math.min(1, rawSeverity)) : undefined;

    const insight = MicroInsightSchema.parse({
      id: `micro-${randomUUID()}`,
      symbol: brief.symbol,
      name: brief.name,
      source: options.source,
      rating: analysis.rating,
      conviction: analysis.conviction,
      severity,
      thesis: analysis.thesis,
      keyDevelopments: analysis.keyDevelopments ?? [],
      risks: analysis.risks ?? [],
      opportunities: analysis.opportunities ?? [],
      sentiment: analysis.sentiment ?? brief.sentimentDirection,
      signalCount: brief.signalCount,
      topSignalIds: brief.signals.slice(0, 5).map((s) => s.id),
      assetSnap: analysis.assetSnap ?? '',
      assetActions: analysis.assetActions ?? [],
      generatedAt: new Date().toISOString(),
      durationMs,
    });

    logger.info('Micro analysis complete', { symbol: brief.symbol, rating: insight.rating, durationMs });
    return insight;
  } catch (err) {
    // Fallback: return a neutral micro insight on parse failure
    logger.warn('Failed to parse micro analysis — using fallback', { symbol: brief.symbol, error: String(err) });
    return {
      id: `micro-${randomUUID()}`,
      symbol: brief.symbol,
      name: brief.name,
      source: options.source,
      rating: 'NEUTRAL',
      conviction: 0.3,
      thesis: `Analysis could not be fully parsed. ${brief.signalCount} signals available for ${brief.symbol}.`,
      keyDevelopments: [],
      risks: [],
      opportunities: [],
      sentiment: brief.sentimentDirection,
      signalCount: brief.signalCount,
      topSignalIds: brief.signals.slice(0, 5).map((s) => s.id),
      assetSnap: '',
      assetActions: [],
      generatedAt: new Date().toISOString(),
      durationMs,
    };
  }
}
