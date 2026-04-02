/**
 * Assessment formatter — converts signals into a compact text format
 * optimized for agent consumption (~50-80 tokens per signal vs ~200-300 raw JSON).
 *
 * Groups signals by ticker with thesis context and position sizing.
 */

import type { Signal } from '../types.js';

export interface TickerThesis {
  rating: string;
  conviction: number;
  thesis: string;
}

export interface TickerPosition {
  marketValue: number;
  portfolioPercent: number;
}

/**
 * Format signals for agent assessment. Compact, pipe-delimited format
 * designed to minimize token usage while preserving all decision-relevant fields.
 */
export function formatSignalsForAssessment(
  signalsByTicker: Map<string, Signal[]>,
  thesisByTicker: Map<string, TickerThesis>,
  positionsByTicker: Map<string, TickerPosition>,
): string {
  const sections: string[] = [];

  for (const [ticker, signals] of signalsByTicker) {
    const position = positionsByTicker.get(ticker);
    const thesis = thesisByTicker.get(ticker);

    // Header with position sizing context
    let header = `## ${ticker} (${signals.length} signals`;
    if (position) {
      header += `, position: $${formatValue(position.marketValue)} / ${(position.portfolioPercent * 100).toFixed(0)}%`;
    }
    header += ')';

    // Thesis context from latest InsightReport
    if (thesis) {
      header += `\nTHESIS: ${thesis.rating} conviction:${thesis.conviction.toFixed(1)} — ${thesis.thesis}`;
    }

    header += '\n---';

    // Signal lines — compact, one per line
    const lines = signals.map((s, i) => {
      const age = formatAge(s.publishedAt);
      const sentiment = s.sentiment ? ` ${s.sentiment}` : '';
      const grouped = s.groupId ? ` group:${s.groupId}` : '';

      return `${i + 1}. [${s.id}] ${s.type} "${truncate(s.title, 80)}" conf:${s.confidence.toFixed(2)}${sentiment} ${age}${grouped}`;
    });

    sections.push(`${header}\n${lines.join('\n')}`);
  }

  return sections.join('\n\n');
}

/** Format a dollar value compactly: $1.2K, $18K, $1.2M */
function formatValue(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return value.toFixed(0);
}

/** Format a timestamp as relative age: "2h ago", "3d ago" */
function formatAge(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Truncate a string to maxLen, adding ellipsis if needed. */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}
