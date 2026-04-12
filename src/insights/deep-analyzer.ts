/**
 * Deep Analyzer — on-demand, single-position deep analysis.
 *
 * Unlike the ProcessInsights pipeline (which produces short 2-3 sentence theses
 * across the full portfolio), this runs a focused, rich LLM call for one position
 * when the user requests it from the Insight modal.
 *
 * Similar depth to what the chat path produces — it gets the full data brief,
 * all signals with their content, the existing insight context, and a system
 * prompt that demands deep reasoning, dot-connecting, and non-obvious implications.
 *
 * Output: streaming markdown text via a callback, suitable for pubsub delivery.
 */

import type { DataBrief } from './data-gatherer.js';
import { formatBriefsForContext } from './data-gatherer.js';
import type { PositionInsight } from './types.js';
import type { ProviderRouter } from '../ai-providers/router.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('deep-analyzer');

const SYSTEM_PROMPT = `You are an expert equity/crypto research analyst producing a deep-dive analysis for a single asset. The user has opened the detail view for this position and wants to understand what's really happening — not a surface-level summary.

Your job: go BEYOND the headline numbers. Identify the real story. Connect dots across signals. Surface non-obvious implications. Challenge the consensus narrative when warranted.

## What "deep" means

1. **Identify the lead narrative.** What is THE story for this asset right now? Not "revenue was X" but "the booking surge is the real story because it signals Y."
2. **Decompose the signals.** For each key signal, explain why it matters in context. An earnings beat means nothing without context — was it driven by one-time items? Is the trend sustainable?
3. **Technical + fundamental synthesis.** Don't list technicals in isolation. "RSI 73 + MFI 88 + above upper BB" together mean something specific — say what it is and what typically happens next.
4. **Flag what to look for.** What should the investor watch in the coming days/weeks? What would confirm or invalidate the thesis?
5. **Identify overhangs and catalysts.** What's the market NOT pricing in? What risk is hiding in plain sight?
6. **Challenge promotional content.** If signals are mostly listicles and hype pieces, say so. Distinguish between real catalysts and noise.

## Format

Write in clear, information-dense prose with markdown formatting:
- Use **bold** for key terms and numbers
- Use bullet lists for multiple discrete points
- Use ## headers to organize sections (e.g., "## The Real Story", "## Technical Setup", "## What to Watch")
- Keep it substantive — aim for 400-800 words of actual insight
- No filler, no hedging language ("it's worth noting that..."), no restating what the user already knows

## Rules

- Base analysis ONLY on the provided data. Do not hallucinate.
- NEVER give directional advice (buy/sell/hold). State what IS happening, not what the user should DO.
- Be specific. "$37.2M bookings vs $10.3M revenue = 3.6x book-to-bill, suggesting..." is better than "bookings were strong."
- When data quality is low (promotional articles, single-source claims), say so explicitly.`;

export interface DeepAnalysisOptions {
  providerRouter: ProviderRouter;
  brief: DataBrief;
  insight: PositionInsight;
  /** Called with each text chunk as it streams in. */
  onDelta: (text: string) => void;
  /** Called when the analysis is complete. */
  onComplete: (fullText: string) => void;
  /** Called on error. */
  onError: (error: string) => void;
}

export async function deepAnalyzePosition(options: DeepAnalysisOptions): Promise<void> {
  const { providerRouter, brief, insight, onDelta, onComplete, onError } = options;
  const start = Date.now();

  try {
    // Build a rich context prompt with full data brief + existing insight
    const briefText = formatBriefsForContext([brief]);

    const contextParts: string[] = [
      `# Deep Analysis Request: ${brief.symbol} (${brief.name})`,
      '',
      '## Current Insight (from portfolio-wide analysis)',
      `**Rating:** ${insight.rating} | **Conviction:** ${(insight.conviction * 100).toFixed(0)}%`,
      `**Thesis:** ${insight.thesis}`,
    ];

    if (insight.keySignals.length > 0) {
      contextParts.push('', '**Key Signals:**');
      for (const sig of insight.keySignals) {
        const detail = sig.detail ? ` — ${sig.detail}` : '';
        contextParts.push(`- [${sig.impact}] ${sig.title}${detail}`);
      }
    }

    if (insight.risks.length > 0) {
      contextParts.push('', '**Risks:** ' + insight.risks.join('; '));
    }
    if (insight.opportunities.length > 0) {
      contextParts.push('', '**Opportunities:** ' + insight.opportunities.join('; '));
    }

    contextParts.push(
      '',
      '---',
      '',
      '## Full Data Brief (all available data for this position)',
      briefText,
      '',
      '---',
      '',
      'Now produce a deep-dive analysis. Go beyond the summary thesis above. ' +
        'What is the real story? What are the non-obvious implications? ' +
        'What should the investor be watching for?',
    );

    const userMessage = contextParts.join('\n');

    // Stream via ProviderRouter — delivers text deltas as they arrive.
    let accumulated = '';

    await providerRouter.streamWithTools({
      model: 'sonnet',
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 4096,
      onTextDelta: (chunk) => {
        accumulated += chunk;
        onDelta(chunk);
      },
    });

    onComplete(accumulated);

    const durationMs = Date.now() - start;
    logger.info('Deep analysis complete', { symbol: brief.symbol, durationMs, chars: accumulated.length });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Deep analysis failed', { symbol: brief.symbol, error: errorMsg });
    onError(errorMsg);
  }
}
