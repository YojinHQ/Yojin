/**
 * Render a StrategyScorecard as Markdown — headline scalars, then per-action table.
 */
import type { StrategyScorecard } from './types.js';

export function scorecardToMarkdown(card: StrategyScorecard): string {
  const lines: string[] = [];
  lines.push(`# Backtest — ${card.strategyName}`);
  lines.push('');
  lines.push(`- **Strategy ID**: \`${card.strategyId}\``);
  lines.push(`- **Window**: ${card.since} → ${card.until} (horizon ${card.horizonDays}d)`);
  lines.push(`- **Generated**: ${card.generatedAt}`);
  lines.push('');
  lines.push('## Score');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| score (hitRate × avgReturn) | **${card.score.toFixed(4)}** |`);
  lines.push(`| hitRate | ${(card.hitRate * 100).toFixed(2)}% |`);
  lines.push(`| avgReturn | ${card.avgReturn.toFixed(4)}% |`);
  lines.push(`| actions (total) | ${card.actionCount} |`);
  lines.push(`| scored | ${card.scoredCount} |`);
  lines.push(`| truncated (horizon past window) | ${card.truncatedCount} |`);
  lines.push(`| no exit data | ${card.noExitDataCount} |`);
  lines.push('');

  if (card.actions.length === 0) {
    lines.push('_No actions fired in this window._');
    return lines.join('\n');
  }

  lines.push('## Actions');
  lines.push('');
  lines.push('| Fired | Ticker | Verdict | Trigger | Entry | Exit | Return% | Hit | Status |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const a of card.actions) {
    lines.push(
      [
        a.firedAt,
        a.ticker,
        a.verdict,
        a.triggerType,
        a.entryPrice.toFixed(4),
        a.exitPrice !== null ? a.exitPrice.toFixed(4) : '—',
        a.returnPct !== null ? a.returnPct.toFixed(3) : '—',
        a.hit === null ? '—' : a.hit ? '✓' : '✗',
        a.status,
      ]
        .map((c) => `| ${c}`)
        .join(' ') + ' |',
    );
  }
  lines.push('');
  return lines.join('\n');
}
