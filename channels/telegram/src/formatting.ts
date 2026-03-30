import type { Action } from '../../../src/actions/types.js';
import type { InsightReport } from '../../../src/insights/types.js';
import type { Snap } from '../../../src/snap/types.js';

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function chunkMessage(text: string, limit = 4096): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    let splitIdx = remaining.lastIndexOf('\n\n', limit);
    if (splitIdx > 0) {
      chunks.push(remaining.slice(0, splitIdx));
      remaining = remaining.slice(splitIdx + 2);
      continue;
    }

    splitIdx = remaining.lastIndexOf('\n', limit);
    if (splitIdx > 0) {
      chunks.push(remaining.slice(0, splitIdx));
      remaining = remaining.slice(splitIdx + 1);
      continue;
    }

    chunks.push(remaining.slice(0, limit));
    remaining = remaining.slice(limit);
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

const SEVERITY_ICON: Record<string, string> = {
  HIGH: '\u{1F534}',
  MEDIUM: '\u{1F7E0}',
  LOW: '\u{1F7E2}',
};

export function formatSnap(snap: Snap): string {
  const lines: string[] = ['\u{1F4CB} <b>Snap Brief</b>', '', escapeHtml(snap.summary), ''];

  if (snap.attentionItems.length > 0) {
    for (const item of snap.attentionItems) {
      const icon = SEVERITY_ICON[item.severity] ?? '\u{2022}';
      const ticker = item.ticker ? ` <code>${escapeHtml(item.ticker)}</code>` : '';
      lines.push(`${icon} ${escapeHtml(item.label)}${ticker}`);
    }
  }

  return lines.join('\n');
}

export function formatAction(action: Action): string {
  return [
    '\u{26A1} <b>New Action</b>',
    '',
    escapeHtml(action.what),
    '',
    `<i>Why:</i> ${escapeHtml(action.why)}`,
    `<i>Source:</i> ${escapeHtml(action.source)}`,
  ].join('\n');
}

export function formatInsight(report: InsightReport): string {
  const lines: string[] = ['\u{1F4CA} <b>Daily Insights Report</b>', ''];

  if (report.portfolio) {
    lines.push(`<b>Health:</b> ${escapeHtml(report.portfolio.overallHealth)}`);
    lines.push(escapeHtml(report.portfolio.summary));
    lines.push('');
  }

  for (const pos of report.positions.slice(0, 5)) {
    lines.push(`<code>${escapeHtml(pos.symbol)}</code>: ${escapeHtml(pos.rating)} — ${escapeHtml(pos.thesis)}`);
  }
  if (report.positions.length > 5) {
    lines.push(`...and ${report.positions.length - 5} more positions`);
  }

  return lines.join('\n');
}
