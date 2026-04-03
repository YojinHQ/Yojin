/**
 * Display tools — UI visualization tools that trigger rich card rendering.
 *
 * On the web app, the chat resolver emits TOOL_CARD events that the frontend
 * renders via ToolRenderer (React components fetch their own data client-side).
 *
 * On other channels (Slack, Telegram, WhatsApp), the structured displayCard
 * data is formatted natively by each channel's formatter.
 *
 * The plain-text tool result gives the LLM real data to reference in its response.
 */

import type { JintelClient } from '@yojinhq/jintel-client';
import { z } from 'zod';

import type { AllocationData, MorningBriefingData, PortfolioOverviewData, PositionsListData } from './display-data.js';
import type { Position } from '../api/graphql/types.js';
import type { ToolDefinition, ToolResult } from '../core/types.js';
import { enrichPortfolioSnapshotWithLiveQuotes } from '../portfolio/live-enrichment.js';
import type { PortfolioSnapshotStore } from '../portfolio/snapshot-store.js';
import { balanceToRange } from '../trust/pii/patterns.js';

export interface DisplayToolsDeps {
  snapshotStore: PortfolioSnapshotStore;
  getJintelClient?: () => JintelClient | undefined;
}

export function createDisplayTools(deps: DisplayToolsDeps): ToolDefinition[] {
  const { snapshotStore, getJintelClient } = deps;

  async function getDisplaySnapshot() {
    const snapshot = await snapshotStore.getLatest();
    if (!snapshot) return null;
    return enrichPortfolioSnapshotWithLiveQuotes(snapshot, getJintelClient?.());
  }

  const displayPortfolioOverview: ToolDefinition = {
    name: 'display_portfolio_overview',
    description:
      'Display a visual portfolio overview card to the user. Shows total value, P&L, return percentage, and largest holdings. Call this when the user asks to see their portfolio performance or overview.',
    parameters: z.object({
      period: z
        .enum(['today', 'week', 'ytd'])
        .describe('Time period for the overview: today, this week, or year-to-date'),
    }),
    async execute(params: { period: 'today' | 'week' | 'ytd' }): Promise<ToolResult> {
      const snapshot = await getDisplaySnapshot();
      if (!snapshot || snapshot.positions.length === 0) {
        return { content: 'No portfolio data available. The user needs to add positions first.' };
      }

      const top = [...snapshot.positions].sort((a, b) => b.marketValue - a.marketValue).slice(0, 5);

      const data: PortfolioOverviewData = {
        period: params.period,
        totalValue: snapshot.totalValue,
        totalPnl: snapshot.totalPnl,
        totalPnlPercent: snapshot.totalPnlPercent,
        positionCount: snapshot.positions.length,
        topHoldings: top.map((p) => ({
          symbol: p.symbol,
          name: p.name,
          marketValue: p.marketValue,
          pnlPercent: p.unrealizedPnlPercent,
        })),
      };

      const card = { type: 'portfolio-overview' as const, data };

      // LLM sees redacted values — exact amounts go only to channels via displayCard
      return {
        content:
          `Displaying portfolio overview card (${params.period}).\n` +
          `Total value: ${balanceToRange(snapshot.totalValue)}, ` +
          `${snapshot.positions.length} positions, ` +
          `P&L: ${snapshot.totalPnl >= 0 ? '+' : ''}${balanceToRange(snapshot.totalPnl)}.`,
        displayCard: card,
      };
    },
  };

  const displayPositionsList: ToolDefinition = {
    name: 'display_positions_list',
    description:
      'Display a visual positions list card to the user. Shows a filtered and sorted list of portfolio positions. Call this when the user asks to see their positions, top performers, worst performers, or biggest movers.',
    parameters: z.object({
      variant: z
        .enum(['top', 'worst', 'movers', 'all'])
        .describe('Which positions to show: top performers, worst performers, biggest movers, or all positions'),
    }),
    async execute(params: { variant: 'top' | 'worst' | 'movers' | 'all' }): Promise<ToolResult> {
      const snapshot = await getDisplaySnapshot();
      if (!snapshot || snapshot.positions.length === 0) {
        return { content: 'No portfolio data available. The user needs to add positions first.' };
      }

      const sortFns: Record<string, (a: Position, b: Position) => number> = {
        top: (a, b) => b.unrealizedPnlPercent - a.unrealizedPnlPercent,
        worst: (a, b) => a.unrealizedPnlPercent - b.unrealizedPnlPercent,
        movers: (a, b) => Math.abs((b.dayChange ?? 0) * b.quantity) - Math.abs((a.dayChange ?? 0) * a.quantity),
        all: (a, b) => b.marketValue - a.marketValue,
      };
      const limit = params.variant === 'all' ? 50 : 5;
      const sorted = [...snapshot.positions].sort(sortFns[params.variant]).slice(0, limit);

      const data: PositionsListData = {
        variant: params.variant,
        positions: sorted.map((p) => ({
          symbol: p.symbol,
          name: p.name,
          marketValue: p.marketValue,
          pnlPercent: p.unrealizedPnlPercent,
          pnl: p.unrealizedPnl,
        })),
        totalValue: snapshot.totalValue,
      };

      const card = { type: 'positions-list' as const, data };

      return {
        content:
          `Displaying ${params.variant} positions (${sorted.length} shown).\n` +
          `Total portfolio value: ${balanceToRange(snapshot.totalValue)}.`,
        displayCard: card,
      };
    },
  };

  const displayAllocation: ToolDefinition = {
    name: 'display_allocation',
    description:
      'Display a visual portfolio allocation card to the user. Shows allocation breakdown by asset class and sector with progress bars. Call this when the user asks about their portfolio allocation, diversification, or sector breakdown.',
    parameters: z.object({}),
    async execute(): Promise<ToolResult> {
      const snapshot = await getDisplaySnapshot();
      if (!snapshot || snapshot.positions.length === 0) {
        return { content: 'No portfolio data available. The user needs to add positions first.' };
      }

      const { totalValue } = snapshot;

      // Group by asset class
      const byAssetClass = new Map<string, number>();
      for (const pos of snapshot.positions) {
        byAssetClass.set(pos.assetClass, (byAssetClass.get(pos.assetClass) ?? 0) + pos.marketValue);
      }
      const assetClassRows = [...byAssetClass.entries()]
        .map(([label, value]) => ({ label, value, weight: totalValue > 0 ? (value / totalValue) * 100 : 0 }))
        .sort((a, b) => b.value - a.value);

      // Group by sector
      const bySector = new Map<string, number>();
      for (const pos of snapshot.positions) {
        const key = pos.sector ?? 'Other';
        bySector.set(key, (bySector.get(key) ?? 0) + pos.marketValue);
      }
      const sectorRows = [...bySector.entries()]
        .map(([label, value]) => ({ label, value, weight: totalValue > 0 ? (value / totalValue) * 100 : 0 }))
        .sort((a, b) => b.value - a.value);

      // Top concentrations
      const topConcentrations = [...snapshot.positions]
        .sort((a, b) => b.marketValue - a.marketValue)
        .slice(0, 3)
        .map((p) => ({
          symbol: p.symbol,
          weight: totalValue > 0 ? (p.marketValue / totalValue) * 100 : 0,
        }));

      const data: AllocationData = {
        totalValue,
        byAssetClass: assetClassRows,
        bySector: sectorRows,
        topConcentrations,
      };

      const card = { type: 'allocation' as const, data };

      // LLM sees redacted value + weight percentages (no exact $)
      const topClasses = assetClassRows
        .slice(0, 3)
        .map((r) => `${r.label} ${r.weight.toFixed(0)}%`)
        .join(', ');
      return {
        content:
          `Displaying allocation breakdown.\n` +
          `Total value: ${balanceToRange(totalValue)}. ` +
          `Asset classes: ${topClasses}. ` +
          `Top concentration: ${topConcentrations[0]?.symbol ?? 'N/A'} at ${topConcentrations[0]?.weight.toFixed(0) ?? 0}%.`,
        displayCard: card,
      };
    },
  };

  const displayMorningBriefing: ToolDefinition = {
    name: 'display_morning_briefing',
    description:
      'Display a visual morning briefing card to the user. Shows a daily summary with portfolio stats, active alerts, recent news headlines, and suggested actions. ALWAYS call this when the user asks for their morning briefing, daily summary, or daily digest.',
    parameters: z.object({}),
    async execute(): Promise<ToolResult> {
      const snapshot = await getDisplaySnapshot();
      if (!snapshot || snapshot.positions.length === 0) {
        return { content: 'No portfolio data available. The user needs to add positions first.' };
      }

      const positions = snapshot.positions;
      const totalValue = snapshot.totalValue;
      const totalPnl = snapshot.totalPnl;
      const totalPnlPercent = snapshot.totalPnlPercent;

      // Top movers by absolute P&L %
      const movers = [...positions]
        .sort((a, b) => Math.abs(b.unrealizedPnlPercent) - Math.abs(a.unrealizedPnlPercent))
        .slice(0, 5)
        .map((p) => ({
          symbol: p.symbol,
          name: p.name,
          pnlPercent: p.unrealizedPnlPercent,
        }));

      const data: MorningBriefingData = {
        date: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
        totalValue,
        totalPnl,
        totalPnlPercent,
        positionCount: positions.length,
        alertCount: 0,
        movers,
        headlines: [],
      };

      const card = { type: 'morning-briefing' as const, data };

      return {
        content:
          `Displaying morning briefing card.\n` +
          `Portfolio: ${balanceToRange(totalValue)} across ${positions.length} positions. ` +
          `${totalPnl >= 0 ? 'Up' : 'Down'} ${balanceToRange(totalPnl)}.`,
        displayCard: card,
      };
    },
  };

  return [displayPortfolioOverview, displayPositionsList, displayAllocation, displayMorningBriefing];
}
