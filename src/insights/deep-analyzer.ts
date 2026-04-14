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
import type { Signal } from '../signals/types.js';

const logger = createSubsystemLogger('deep-analyzer');

/** Max number of full signal contents to include in the deep analysis context. */
const MAX_FULL_SIGNALS = 12;
/** Max characters of signal content to include per signal. */
const MAX_CONTENT_CHARS = 3000;

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
  /** Full signal objects from the archive — includes content, metadata.link, etc. */
  signals?: Signal[];
  /** Called with each text chunk as it streams in. */
  onDelta: (text: string) => void;
  /** Called when the analysis is complete. */
  onComplete: (fullText: string) => void;
  /** Called on error. */
  onError: (error: string) => void;
}

export async function deepAnalyzePosition(options: DeepAnalysisOptions): Promise<void> {
  const { providerRouter, brief, insight, signals, onDelta, onComplete, onError } = options;
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

    contextParts.push('', '---', '', '## Full Data Brief (all available data for this position)', briefText);

    // Include full signal content for deeper reasoning — this is the key
    // difference between the shallow modal analysis and the rich chat analysis.
    const signalContent = formatSignalContent(signals ?? []);
    if (signalContent) {
      contextParts.push('', '---', '', '## Source Material (full signal content)', signalContent);
    }

    contextParts.push(
      '',
      '---',
      '',
      'Now produce a deep-dive analysis. Go beyond the summary thesis above. ' +
        'Read through the source material carefully. ' +
        'What is the real story? What are the non-obvious implications? ' +
        'What should the investor be watching for?',
    );

    const userMessage = contextParts.join('\n');

    // Stream via ProviderRouter — delivers text deltas as they arrive.
    let accumulated = '';

    // Use more tokens when we have full source content to reason over.
    const hasSourceContent = signals && signals.some((s) => s.content);
    const maxTokens = hasSourceContent ? 8192 : 4096;

    await providerRouter.streamWithTools({
      model: 'sonnet',
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens,
      onTextDelta: (chunk) => {
        accumulated += chunk;
        onDelta(chunk);
      },
    });

    onComplete(accumulated);

    const durationMs = Date.now() - start;
    logger.info('Deep analysis complete', {
      symbol: brief.symbol,
      durationMs,
      chars: accumulated.length,
      signalsWithContent: signals?.filter((s) => s.content).length ?? 0,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Deep analysis failed', { symbol: brief.symbol, error: errorMsg });
    onError(errorMsg);
  }
}

// ---------------------------------------------------------------------------
// Format full signal content for the LLM context
// ---------------------------------------------------------------------------

/**
 * Formats full signal content for inclusion in the deep analysis prompt.
 * Prioritizes signals that have actual content (article text, transcripts),
 * then falls back to signals with tier2 summaries.
 */
function formatSignalContent(signals: Signal[]): string {
  if (signals.length === 0) return '';

  // Prioritize: signals with content first, then by recency
  const withContent = signals.filter((s) => s.content && s.content.length > 50);
  const withoutContent = signals.filter((s) => !s.content || s.content.length <= 50);

  // Take up to MAX_FULL_SIGNALS — prefer those with content
  const selected = [...withContent, ...withoutContent].slice(0, MAX_FULL_SIGNALS);

  if (selected.length === 0) return '';

  const parts: string[] = [];

  for (const signal of selected) {
    const link = (signal.metadata?.link as string) || '';
    const header = `### ${signal.title} [${signal.type}]`;
    const meta: string[] = [];
    if (signal.publishedAt) meta.push(`Published: ${signal.publishedAt.slice(0, 10)}`);
    if (signal.sources.length > 0) meta.push(`Sources: ${signal.sources.map((s) => s.id).join(', ')}`);
    if (link) meta.push(`URL: ${link}`);

    const lines = [header];
    if (meta.length > 0) lines.push(meta.join(' | '));

    if (signal.content && signal.content.length > 50) {
      // Include full content, truncated to MAX_CONTENT_CHARS
      const content =
        signal.content.length > MAX_CONTENT_CHARS
          ? signal.content.slice(0, MAX_CONTENT_CHARS) + '\n[...truncated]'
          : signal.content;
      lines.push('', content);
    } else if (signal.tier2) {
      lines.push('', signal.tier2);
    } else if (signal.tier1) {
      lines.push('', signal.tier1);
    }

    parts.push(lines.join('\n'));
  }

  return parts.join('\n\n---\n\n');
}
