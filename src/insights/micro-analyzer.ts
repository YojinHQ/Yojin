/**
 * Micro Analyzer — single Haiku LLM call per asset.
 *
 * Takes a pre-built DataBrief and produces a MicroInsight via a direct
 * ProviderRouter call (no agent loop, no orchestrator overhead).
 *
 * Cost: ~$0.001 per call, <10 seconds.
 */

import { randomUUID } from 'node:crypto';

import type { DataBrief } from './data-gatherer.js';
import { formatBriefsForContext } from './data-gatherer.js';
import { MicroInsightSchema } from './micro-types.js';
import type { MicroInsight, MicroInsightSource } from './micro-types.js';
import type { ProviderRouter } from '../ai-providers/router.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('micro-analyzer');

const SYSTEM_PROMPT = `You are a concise equity research analyst. Analyze the provided asset data and produce a structured JSON research note.

Output ONLY valid JSON matching this schema:
{
  "rating": "VERY_BULLISH" | "BULLISH" | "NEUTRAL" | "BEARISH" | "VERY_BEARISH",
  "conviction": 0.0-1.0,
  "thesis": "2-3 sentence outlook",
  "keyDevelopments": ["up to 3 bullet points of notable recent developments"],
  "risks": ["up to 3 risk factors"],
  "opportunities": ["up to 3 opportunity factors"],
  "sentiment": "BULLISH" | "BEARISH" | "MIXED" | "NEUTRAL",
  "assetSnap": "1 sentence: what is most notable about this asset right now",
  "assetActions": ["0-2 concrete observation-style action items, framed as neutral observations not directives"]
}

Rules:
- Base your analysis ONLY on the provided data. Do not hallucinate.
- Frame action items as observations, not buy/sell recommendations. Example: "RSI at 22 suggests oversold conditions" not "Buy now".
- If data is limited, express lower conviction and say so in the thesis.
- Be concise. Every field should be information-dense.`;

export interface AnalyzeTickerOptions {
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
    model: 'haiku',
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

    const insight = MicroInsightSchema.parse({
      id: `micro-${randomUUID().slice(0, 8)}`,
      symbol: brief.symbol,
      name: brief.name,
      source: options.source,
      rating: analysis.rating,
      conviction: analysis.conviction,
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
      id: `micro-${randomUUID().slice(0, 8)}`,
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
