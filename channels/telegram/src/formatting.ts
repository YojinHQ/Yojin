import type { Action } from '../../../src/actions/types.js';
import { chunkMessage as chunkMessageBase, escapeHtml } from '../../../src/formatting/index.js';
import type { InsightReport } from '../../../src/insights/types.js';
import type { Snap } from '../../../src/snap/types.js';

export { escapeHtml } from '../../../src/formatting/index.js';

const TELEGRAM_LIMIT = 4096;

export function chunkMessage(text: string, limit = TELEGRAM_LIMIT): string[] {
  return chunkMessageBase(text, limit);
}

export function formatSnap(snap: Snap): string {
  const lines: string[] = ['\u{1F4CB} <b>Snap Brief</b>'];

  if (snap.intelSummary) {
    lines.push('', escapeHtml(snap.intelSummary), '');
  }

  if (snap.actionItems.length > 0) {
    lines.push('<b>Actions:</b>');
    for (const item of snap.actionItems) {
      lines.push(`\u{2022} ${escapeHtml(item.text)}`);
    }
  }

  return lines.join('\n');
}

export function formatAction(action: Action): string {
  const ticker = action.source?.match(/micro-observation:\s*(\S+)/)?.[1];
  const header = ticker ? `\u{26A1} <b>${escapeHtml(ticker)}</b>` : '\u{26A1} <b>New Action</b>';
  return [header, escapeHtml(action.what)].join('\n');
}

export function formatInsight(report: InsightReport): string {
  const lines: string[] = ['\u{1F4CA} <b>Daily Insights Report</b>', ''];

  if (report.portfolio) {
    lines.push(`<b>Health:</b> ${escapeHtml(report.portfolio.overallHealth)}`);
  }

  // Compact position ratings — one line, symbol + rating only
  if (report.positions.length > 0) {
    const ratings = report.positions.map((p) => `${escapeHtml(p.symbol)} ${escapeHtml(p.rating)}`).join(' \u{2022} ');
    lines.push(ratings);
  }

  // Top actions as short bullets (max 3)
  const actions = report.portfolio?.actionItems ?? [];
  if (actions.length > 0) {
    lines.push('');
    for (const item of actions.slice(0, 3)) {
      const text = typeof item === 'string' ? item : item.text;
      lines.push(`\u{2022} ${escapeHtml(text)}`);
    }
  }

  lines.push('', '<i>Open Yojin for full report</i>');

  return lines.join('\n');
}
