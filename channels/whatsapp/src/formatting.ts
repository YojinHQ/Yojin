import type { Action } from '../../../src/actions/types.js';
import type { InsightReport } from '../../../src/insights/types.js';
import type { Snap } from '../../../src/snap/types.js';

/** Convert Markdown/HTML to WhatsApp markup (*bold*, _italic_, ~strike~, ```mono```). */
export function toWhatsApp(text: string): string {
  let result = text;

  result = result.replace(/<b>([\s\S]*?)<\/b>/gi, '*$1*');
  result = result.replace(/<strong>([\s\S]*?)<\/strong>/gi, '*$1*');
  result = result.replace(/<i>([\s\S]*?)<\/i>/gi, '_$1_');
  result = result.replace(/<em>([\s\S]*?)<\/em>/gi, '_$1_');
  result = result.replace(/<s>([\s\S]*?)<\/s>/gi, '~$1~');
  result = result.replace(/<del>([\s\S]*?)<\/del>/gi, '~$1~');
  result = result.replace(/<code>([\s\S]*?)<\/code>/gi, '```$1```');

  result = result.replace(/<[^>]+>/g, '');

  result = result.replace(/&amp;/g, '&');
  result = result.replace(/&lt;/g, '<');
  result = result.replace(/&gt;/g, '>');

  result = result.replace(/\*\*([^*]+)\*\*/g, '*$1*');
  result = result.replace(/~~([^~]+)~~/g, '~$1~');
  result = result.replace(/(?<!`)`([^`\n]+)`(?!`)/g, '```$1```');

  return result;
}

/**
 * Split a long message into chunks that fit within WhatsApp's 65536-char limit.
 * Prefers splitting at paragraph boundaries (\n\n), then line boundaries (\n),
 * then hard-cuts if no boundary is found.
 */
export function chunkMessage(text: string, limit = 65536): string[] {
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

export function formatSnap(snap: Snap): string {
  const lines: string[] = ['\u{1F4CB} *Snap Brief*'];

  if (snap.intelSummary) {
    lines.push('', snap.intelSummary, '');
  }

  if (snap.actionItems.length > 0) {
    lines.push('*Actions:*');
    for (const item of snap.actionItems) {
      lines.push(`\u{2022} ${item.text}`);
    }
  }

  return lines.join('\n');
}

export function formatAction(action: Action): string {
  return ['\u{26A1} *New Action*', '', action.what, '', `_Why:_ ${action.why}`, `_Source:_ ${action.source}`].join(
    '\n',
  );
}

export function formatInsight(report: InsightReport): string {
  const lines: string[] = ['\u{1F4CA} *Daily Insights Report*', ''];

  if (report.portfolio) {
    lines.push(`*Health:* ${report.portfolio.overallHealth}`);
    lines.push(report.portfolio.summary);
    lines.push('');
  }

  for (const pos of report.positions.slice(0, 5)) {
    lines.push(`\`\`\`${pos.symbol}\`\`\`: ${pos.rating} — ${pos.thesis}`);
  }
  if (report.positions.length > 5) {
    lines.push(`...and ${report.positions.length - 5} more positions`);
  }

  return lines.join('\n');
}
