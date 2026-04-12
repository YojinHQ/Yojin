/**
 * Channel-specific display card formatters.
 *
 * Each function converts structured DisplayCardData into a format
 * suitable for the target channel. Channels import and call these
 * in their sendMessage implementation.
 */

import type { DisplayCardData, StrategyProposalData } from './display-data.js';
import { fmtCurrency, fmtPnl, pnlEmoji } from './display-format-helpers.js';
import { escapeHtml } from '../formatting/index.js';

function formatStrategyProposalPlain(d: StrategyProposalData, escape: (s: string) => string = (s) => s): string {
  const lines = [
    `Strategy Proposal: ${escape(d.name)}`,
    '',
    escape(d.description),
    '',
    `Category: ${escape(d.category)} | Style: ${escape(d.style)}`,
  ];
  if (d.tickers.length > 0) lines.push(`Tickers: ${d.tickers.map(escape).join(', ')}`);
  if (d.maxPositionSize !== undefined) {
    lines.push(`Max Position Size: ${(d.maxPositionSize * 100).toFixed(0)}%`);
  }
  lines.push('', 'Triggers:');
  for (const t of d.triggers) lines.push(`  ${escape(t.type)}: ${escape(t.description)}`);
  return lines.join('\n');
}

function formatStrategyProposalTelegram(d: StrategyProposalData): string {
  const esc = escapeHtml;
  const lines = [
    `\u{1F4A1} <b>Strategy Proposal:</b> ${esc(d.name)}`,
    '',
    esc(d.description),
    '',
    `<b>Category:</b> ${esc(d.category)} | <b>Style:</b> ${esc(d.style)}`,
  ];
  if (d.tickers.length > 0) {
    lines.push(`<b>Tickers:</b> ${d.tickers.map((t) => `<code>${esc(t)}</code>`).join(', ')}`);
  }
  if (d.maxPositionSize !== undefined) {
    lines.push(`<b>Max Position Size:</b> ${(d.maxPositionSize * 100).toFixed(0)}%`);
  }
  lines.push('', '<b>Triggers:</b>');
  for (const t of d.triggers) {
    lines.push(`  \u2022 <code>${esc(t.type)}</code>: ${esc(t.description)}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Slack (mrkdwn)
// ---------------------------------------------------------------------------

export function formatDisplayCardForSlack(card: DisplayCardData): string {
  switch (card.type) {
    case 'portfolio-overview': {
      const d = card.data;
      const direction = d.totalPnl >= 0 ? 'Up' : 'Down';
      const lines = [
        `${pnlEmoji(d.totalPnl)} *Portfolio Overview* \u2014 ${d.period.toUpperCase()}`,
        '',
        `*Total Value:* ${fmtCurrency(d.totalValue)} | *P&L:* ${direction} ${fmtCurrency(d.totalPnl)} (${fmtPnl(d.totalPnlPercent)}) | *Positions:* ${d.positionCount}`,
      ];
      if (d.topHoldings.length > 0) {
        lines.push('', '*Top Holdings:*');
        for (const h of d.topHoldings) {
          lines.push(`  \u2022 \`${h.symbol}\` ${fmtCurrency(h.marketValue)} (${fmtPnl(h.pnlPercent)})`);
        }
      }
      return lines.join('\n');
    }

    case 'positions-list': {
      const d = card.data;
      const titles: Record<string, string> = {
        top: '\u{1F4C8} *Top Performers*',
        worst: '\u{1F4C9} *Underperformers*',
        movers: "\u{26A1} *Today's Movers*",
        all: '\u{1F4CB} *All Positions*',
      };
      const lines = [titles[d.variant] ?? '*Positions*', ''];
      for (const p of d.positions) {
        lines.push(`  \u2022 \`${p.symbol}\` ${fmtCurrency(p.marketValue)} (${fmtPnl(p.pnlPercent)})`);
      }
      lines.push('', `*Total:* ${fmtCurrency(d.totalValue)}`);
      return lines.join('\n');
    }

    case 'allocation': {
      const d = card.data;
      const lines = ['\u{1F4CA} *Allocation Breakdown*', '', `*Total Value:* ${fmtCurrency(d.totalValue)}`];
      if (d.byAssetClass.length > 0) {
        lines.push('', '*By Asset Class:*');
        for (const row of d.byAssetClass) {
          lines.push(`  \u2022 ${row.label}: ${row.weight.toFixed(1)}%`);
        }
      }
      if (d.topConcentrations.length > 0) {
        lines.push('', '*Top Concentrations:*');
        for (const c of d.topConcentrations) {
          lines.push(`  \u2022 \`${c.symbol}\` ${c.weight.toFixed(1)}%`);
        }
      }
      return lines.join('\n');
    }

    case 'morning-briefing': {
      const d = card.data;
      const direction = d.totalPnl >= 0 ? 'Up' : 'Down';
      const lines = [
        `\u{2600}\u{FE0F} *Morning Briefing* \u2014 ${d.date}`,
        '',
        `*Portfolio:* ${fmtCurrency(d.totalValue)} across ${d.positionCount} positions`,
        `${direction} ${fmtCurrency(d.totalPnl)} (${fmtPnl(d.totalPnlPercent)})`,
        `*Active Alerts:* ${d.alertCount}`,
      ];
      if (d.movers.length > 0) {
        lines.push('', '*Movers:*');
        for (const m of d.movers) {
          lines.push(`  \u2022 \`${m.symbol}\` ${fmtPnl(m.pnlPercent)}`);
        }
      }
      if (d.headlines.length > 0) {
        lines.push('', '*Headlines:*');
        for (const h of d.headlines) {
          lines.push(`  \u2022 ${h.title} _(${h.source})_`);
        }
      }
      return lines.join('\n');
    }

    case 'strategy-proposal':
      return formatStrategyProposalPlain(card.data);
  }
}

// ---------------------------------------------------------------------------
// Telegram (HTML)
// ---------------------------------------------------------------------------

const esc = escapeHtml;

export function formatDisplayCardForTelegram(card: DisplayCardData): string {
  switch (card.type) {
    case 'portfolio-overview': {
      const d = card.data;
      const direction = d.totalPnl >= 0 ? 'Up' : 'Down';
      const lines = [
        `${pnlEmoji(d.totalPnl)} <b>Portfolio Overview</b> \u2014 ${esc(d.period.toUpperCase())}`,
        '',
        `<b>Total Value:</b> ${esc(fmtCurrency(d.totalValue))}`,
        `<b>P&amp;L:</b> ${direction} ${esc(fmtCurrency(d.totalPnl))} (${esc(fmtPnl(d.totalPnlPercent))})`,
        `<b>Positions:</b> ${d.positionCount}`,
      ];
      if (d.topHoldings.length > 0) {
        lines.push('', '<b>Top Holdings:</b>');
        for (const h of d.topHoldings) {
          lines.push(
            `  \u2022 <code>${esc(h.symbol)}</code> ${esc(fmtCurrency(h.marketValue))} (${esc(fmtPnl(h.pnlPercent))})`,
          );
        }
      }
      return lines.join('\n');
    }

    case 'positions-list': {
      const d = card.data;
      const titles: Record<string, string> = {
        top: `${pnlEmoji(1)} <b>Top Performers</b>`,
        worst: `${pnlEmoji(-1)} <b>Underperformers</b>`,
        movers: "\u{26A1} <b>Today's Movers</b>",
        all: '\u{1F4CB} <b>All Positions</b>',
      };
      const lines = [titles[d.variant] ?? '<b>Positions</b>', ''];
      for (const p of d.positions) {
        lines.push(
          `  \u2022 <code>${esc(p.symbol)}</code> ${esc(fmtCurrency(p.marketValue))} (${esc(fmtPnl(p.pnlPercent))})`,
        );
      }
      lines.push('', `<b>Total:</b> ${esc(fmtCurrency(d.totalValue))}`);
      return lines.join('\n');
    }

    case 'allocation': {
      const d = card.data;
      const lines = [
        '\u{1F4CA} <b>Allocation Breakdown</b>',
        '',
        `<b>Total Value:</b> ${esc(fmtCurrency(d.totalValue))}`,
      ];
      if (d.byAssetClass.length > 0) {
        lines.push('', '<b>By Asset Class:</b>');
        for (const row of d.byAssetClass) {
          lines.push(`  \u2022 ${esc(row.label)}: ${row.weight.toFixed(1)}%`);
        }
      }
      if (d.topConcentrations.length > 0) {
        lines.push('', '<b>Top Concentrations:</b>');
        for (const c of d.topConcentrations) {
          lines.push(`  \u2022 <code>${esc(c.symbol)}</code> ${c.weight.toFixed(1)}%`);
        }
      }
      return lines.join('\n');
    }

    case 'morning-briefing': {
      const d = card.data;
      const direction = d.totalPnl >= 0 ? 'Up' : 'Down';
      const lines = [
        `\u{2600}\u{FE0F} <b>Morning Briefing</b> \u2014 ${esc(d.date)}`,
        '',
        `<b>Portfolio:</b> ${esc(fmtCurrency(d.totalValue))} across ${d.positionCount} positions`,
        `${direction} ${esc(fmtCurrency(d.totalPnl))} (${esc(fmtPnl(d.totalPnlPercent))})`,
        `<b>Active Alerts:</b> ${d.alertCount}`,
      ];
      if (d.movers.length > 0) {
        lines.push('', '<b>Movers:</b>');
        for (const m of d.movers) {
          lines.push(`  \u2022 <code>${esc(m.symbol)}</code> ${esc(fmtPnl(m.pnlPercent))}`);
        }
      }
      if (d.headlines.length > 0) {
        lines.push('', '<b>Headlines:</b>');
        for (const h of d.headlines) {
          lines.push(`  \u2022 ${esc(h.title)} <i>(${esc(h.source)})</i>`);
        }
      }
      return lines.join('\n');
    }

    case 'strategy-proposal':
      return formatStrategyProposalTelegram(card.data);
  }
}

// ---------------------------------------------------------------------------
// WhatsApp (basic markup: *bold*, _italic_)
// ---------------------------------------------------------------------------

export function formatDisplayCardForWhatsApp(card: DisplayCardData): string {
  switch (card.type) {
    case 'portfolio-overview': {
      const d = card.data;
      const direction = d.totalPnl >= 0 ? 'Up' : 'Down';
      const lines = [
        `${pnlEmoji(d.totalPnl)} *Portfolio Overview* \u2014 ${d.period.toUpperCase()}`,
        '',
        `*Total Value:* ${fmtCurrency(d.totalValue)}`,
        `*P&L:* ${direction} ${fmtCurrency(d.totalPnl)} (${fmtPnl(d.totalPnlPercent)})`,
        `*Positions:* ${d.positionCount}`,
      ];
      if (d.topHoldings.length > 0) {
        lines.push('', '*Top Holdings:*');
        for (const h of d.topHoldings) {
          lines.push(`  \u2022 ${h.symbol} ${fmtCurrency(h.marketValue)} (${fmtPnl(h.pnlPercent)})`);
        }
      }
      return lines.join('\n');
    }

    case 'positions-list': {
      const d = card.data;
      const titles: Record<string, string> = {
        top: '*Top Performers*',
        worst: '*Underperformers*',
        movers: "*Today's Movers*",
        all: '*All Positions*',
      };
      const lines = [titles[d.variant] ?? '*Positions*', ''];
      for (const p of d.positions) {
        lines.push(`  \u2022 ${p.symbol} ${fmtCurrency(p.marketValue)} (${fmtPnl(p.pnlPercent)})`);
      }
      lines.push('', `*Total:* ${fmtCurrency(d.totalValue)}`);
      return lines.join('\n');
    }

    case 'allocation': {
      const d = card.data;
      const lines = ['*Allocation Breakdown*', '', `*Total Value:* ${fmtCurrency(d.totalValue)}`];
      if (d.byAssetClass.length > 0) {
        lines.push('', '*By Asset Class:*');
        for (const row of d.byAssetClass) {
          lines.push(`  \u2022 ${row.label}: ${row.weight.toFixed(1)}%`);
        }
      }
      if (d.topConcentrations.length > 0) {
        lines.push('', '*Top Concentrations:*');
        for (const c of d.topConcentrations) {
          lines.push(`  \u2022 ${c.symbol} ${c.weight.toFixed(1)}%`);
        }
      }
      return lines.join('\n');
    }

    case 'morning-briefing': {
      const d = card.data;
      const direction = d.totalPnl >= 0 ? 'Up' : 'Down';
      const lines = [
        `*Morning Briefing* \u2014 ${d.date}`,
        '',
        `*Portfolio:* ${fmtCurrency(d.totalValue)} across ${d.positionCount} positions`,
        `${direction} ${fmtCurrency(d.totalPnl)} (${fmtPnl(d.totalPnlPercent)})`,
        `*Active Alerts:* ${d.alertCount}`,
      ];
      if (d.movers.length > 0) {
        lines.push('', '*Movers:*');
        for (const m of d.movers) {
          lines.push(`  \u2022 ${m.symbol} ${fmtPnl(m.pnlPercent)}`);
        }
      }
      if (d.headlines.length > 0) {
        lines.push('', '*Headlines:*');
        for (const h of d.headlines) {
          lines.push(`  \u2022 ${h.title} _(${h.source})_`);
        }
      }
      return lines.join('\n');
    }

    case 'strategy-proposal':
      return formatStrategyProposalPlain(card.data);
  }
}
