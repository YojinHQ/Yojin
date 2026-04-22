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
  "assetSnap": "1 sentence: the single most notable observation about this asset right now. When a clear catalyst exists in the data, connect the metric to it. When no catalyst is visible, describe what changed and say cause is unclear. Bad: 'Social mentions up +70 to 168'. Good: 'Social buzz surging alongside Truist PT raise to $180' or 'Social mentions spiked 70% with no clear catalyst in recent news'.",
  "assetActions": ["1-3 bullet-point summaries of the key NEWS and EVENTS for this asset. Focus on real-world catalysts: earnings, analyst actions, deals, regulatory moves, corporate developments. Cross-reference data — connect social spikes to news, price moves to filings, sentiment shifts to catalysts. NEVER include technical indicators (RSI, MACD, Bollinger Bands, moving averages) — those belong in the analysis, not in actions. NEVER include meta-commentary about data quality or dataset gaps. If there are no real events, return a single item summarizing the most notable factual observation. Always include at least 1 item."]
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
- NEVER use placeholder tokens like <AMOUNT>, <DATE>, <PRICE>, <TICKER>, or any <...> stand-in. If a specific number, date, or value is not present in the provided data, omit the clause entirely or describe it qualitatively (e.g. "a recent bond issuance" instead of "a <AMOUNT> bond issuance"). Cite only values that appear verbatim in the data.

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

Connect the dots — but only when the evidence supports it:
- Don't report a metric change in isolation. A social spike, price move, volume surge, or sentiment shift is a data point — look for what's driving it using other data in the brief.
- When social momentum changes (mentions, rank, upvotes), check: is there a news event, earnings date, analyst action, or filing in the same timeframe that plausibly explains it? Only link them if the timing and subject matter align. Co-occurrence is not causation — a social spike on the same day as an unrelated news article is NOT a connection.
- When a metric changes but no catalyst is visible in the data, say so honestly: "Social buzz spiked with no clear catalyst in recent news" — and stop there. Don't speculate about causes you can't see. "Cause unclear" is a valid and useful conclusion.
- NEVER fabricate correlations to make a summary sound more insightful. "Social mentions surged after Truist cut PT" is only valid if the Truist cut actually appears in the data AND the timing makes sense. If the PT cut was 5 days ago and the social spike is today, they're probably unrelated.
- Cross-reference across data types when the connection is evident: news + social (headline went viral), filings + price (price moved on the day of an SEC filing), analyst action + sentiment shift. But only state a link when you have concrete evidence for it in the brief.
- The question every summary should try to answer: "Why is this happening, and should I care?" If you genuinely can't answer "why" from the data, just describe what changed and its magnitude — that's still more useful than forcing a false narrative.
- A summary that just restates metrics ("mentions up +70, upvotes 709, rank #5") is low value. A summary that provides real context is high value. But a false correlation is worse than both — it actively misleads.

Supply-chain context:
- The brief may include a "Supply chain" section listing upstream suppliers/partners (with criticality 0-1), downstream customers (with revenue share), and concentration flags (HHI).
- Factor upstream dependency into risk observations: when a high-criticality supplier has recent bearish signals, that's a real second-order risk to this ticker (e.g. "AAPL's top supplier TSM is flagging capacity issues"). Cite the counterparty by name.
- Factor downstream demand into opportunity/risk observations: when a large-share customer shows sentiment or news shifts, that's demand-side signal for this ticker.
- Concentration flags (CUSTOMER/SEGMENT/GEOGRAPHY/PRODUCT with HHI ≥ 2500) are structural risks — mention when material to the current observation.
- Only connect counterparty signals to this ticker when the link is direct and the timing makes sense. A generic TSM news item from last month is not an AAPL catalyst today. If the supply-chain section is absent or sparse, ignore it — don't fabricate dependencies.
- Never put supply-chain observations in assetActions unless there is a concrete NEWS/EVENT (e.g. "TSM cut guidance" is an event; "AAPL depends on TSM" is structural context, belongs in thesis/risks).

Content priorities:
- Lead with the most impactful narrative — real events, earnings, analyst actions, corporate developments, macro shifts. Use technicals as supporting context, not the headline.
- assetActions must be NEWS and EVENTS only. Say "Truist cuts price target to $323 amid macro headwinds" not "RSI at 38.5 approaching oversold". Never put technical indicators, Bollinger Bands, MACD, RSI, or moving averages in assetActions.
- Never put meta-commentary about data quality in assetActions. "No fund-level catalyst in dataset" is not an action — skip it.
- NEVER write summaries that say "no developments are present" or "nothing to report". If there is genuinely nothing material, return an empty assetActions array. Silence is better than a summary that says "we have nothing".
- If all available data is low-quality promotional content, say so in the thesis and lower conviction accordingly.
- Be concise. Every field should be information-dense.`;

interface AnalyzeTickerOptions {
  source: MicroInsightSource;
  /**
   * Reasons from progressive-enrichment triggers that fired for this ticker.
   * Rendered as a focus hint so the LLM knows why extras were fetched.
   */
  triggerReasons?: string[];
}

export async function analyzeTicker(
  brief: DataBrief,
  providerRouter: ProviderRouter,
  options: AnalyzeTickerOptions,
): Promise<MicroInsight> {
  const start = Date.now();
  const briefText = formatBriefsForContext([brief]);
  const focus =
    options.triggerReasons && options.triggerReasons.length > 0
      ? `\n\nFocus hints (enrichment triggers fired):\n${options.triggerReasons.map((r) => `- ${r}`).join('\n')}`
      : '';

  const result = await providerRouter.completeWithTools({
    model: 'sonnet',
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Analyze ${brief.symbol} (${brief.name}):\n\n${briefText}${focus}` }],
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
