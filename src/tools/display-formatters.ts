/**
 * Plain-text formatters for display card data.
 *
 * Used as the universal fallback for channels without custom formatters
 * and as the tool result content that the LLM sees.
 */

import type {
  AllocationData,
  DisplayCardData,
  MorningBriefingData,
  PortfolioOverviewData,
  PositionsListData,
  StrategyProposalData,
} from './display-data.js';
import { fmtCurrency, fmtPnl } from './display-format-helpers.js';

function formatPortfolioOverview(data: PortfolioOverviewData): string {
  const direction = data.totalPnl >= 0 ? 'Up' : 'Down';
  const lines = [
    `Portfolio Overview (${data.period.toUpperCase()})`,
    '',
    `Total Value: ${fmtCurrency(data.totalValue)}`,
    `P&L: ${direction} ${fmtCurrency(data.totalPnl)} (${fmtPnl(data.totalPnlPercent)})`,
    `Positions: ${data.positionCount}`,
  ];

  if (data.topHoldings.length > 0) {
    lines.push('', 'Top Holdings:');
    for (const h of data.topHoldings) {
      lines.push(`  ${h.symbol} — ${fmtCurrency(h.marketValue)} (${fmtPnl(h.pnlPercent)})`);
    }
  }

  return lines.join('\n');
}

function formatPositionsList(data: PositionsListData): string {
  const variantLabels: Record<string, string> = {
    top: 'Top Performers',
    worst: 'Underperformers',
    movers: "Today's Movers",
    all: 'All Positions',
  };

  const lines = [variantLabels[data.variant] ?? 'Positions', ''];

  for (const p of data.positions) {
    lines.push(`  ${p.symbol} — ${fmtCurrency(p.marketValue)} (${fmtPnl(p.pnlPercent)})`);
  }

  lines.push('', `Total Value: ${fmtCurrency(data.totalValue)}`);
  return lines.join('\n');
}

function formatAllocation(data: AllocationData): string {
  const lines = ['Allocation Breakdown', '', `Total Value: ${fmtCurrency(data.totalValue)}`];

  if (data.byAssetClass.length > 0) {
    lines.push('', 'By Asset Class:');
    for (const row of data.byAssetClass) {
      lines.push(`  ${row.label}: ${row.weight.toFixed(1)}% (${fmtCurrency(row.value)})`);
    }
  }

  if (data.bySector.length > 0) {
    lines.push('', 'By Sector:');
    for (const row of data.bySector) {
      lines.push(`  ${row.label}: ${row.weight.toFixed(1)}% (${fmtCurrency(row.value)})`);
    }
  }

  if (data.topConcentrations.length > 0) {
    lines.push('', 'Top Concentrations:');
    for (const c of data.topConcentrations) {
      lines.push(`  ${c.symbol}: ${c.weight.toFixed(1)}%`);
    }
  }

  return lines.join('\n');
}

function formatStrategyProposal(data: StrategyProposalData): string {
  const lines = [
    `Strategy Proposal: ${data.name}`,
    '',
    data.description,
    '',
    `Category: ${data.category} | Style: ${data.style}`,
  ];

  if (data.tickers.length > 0) {
    lines.push(`Tickers: ${data.tickers.join(', ')}`);
  }

  if (data.maxPositionSize !== undefined) {
    lines.push(`Max Position Size: ${(data.maxPositionSize * 100).toFixed(0)}%`);
  }

  lines.push('', 'Triggers:');
  for (const t of data.triggers) {
    lines.push(`  ${t.type}: ${t.description}`);
  }

  return lines.join('\n');
}

function formatMorningBriefing(data: MorningBriefingData): string {
  const direction = data.totalPnl >= 0 ? 'Up' : 'Down';
  const lines = [
    `Morning Briefing — ${data.date}`,
    '',
    `Portfolio: ${fmtCurrency(data.totalValue)} across ${data.positionCount} positions`,
    `${direction} ${fmtCurrency(data.totalPnl)} (${fmtPnl(data.totalPnlPercent)})`,
    `Active Alerts: ${data.alertCount}`,
  ];

  if (data.movers.length > 0) {
    lines.push('', 'Movers:');
    for (const m of data.movers) {
      lines.push(`  ${m.symbol} ${fmtPnl(m.pnlPercent)}`);
    }
  }

  if (data.headlines.length > 0) {
    lines.push('', 'Headlines:');
    for (const h of data.headlines) {
      lines.push(`  ${h.title} (${h.source})`);
    }
  }

  return lines.join('\n');
}

/** Format any display card data to plain text. */
export function formatDisplayCard(card: DisplayCardData): string {
  switch (card.type) {
    case 'portfolio-overview':
      return formatPortfolioOverview(card.data);
    case 'positions-list':
      return formatPositionsList(card.data);
    case 'allocation':
      return formatAllocation(card.data);
    case 'morning-briefing':
      return formatMorningBriefing(card.data);
    case 'strategy-proposal':
      return formatStrategyProposal(card.data);
  }
}
