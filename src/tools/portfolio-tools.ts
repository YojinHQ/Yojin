/**
 * Portfolio tools — save and query portfolio positions.
 *
 * These tools let the agent persist positions extracted from portfolio
 * screenshots (or other sources) and retrieve the current portfolio state.
 */

import { z } from 'zod';

import type { AssetClass, Platform, Position } from '../api/graphql/types.js';
import { AssetClassSchema } from '../api/graphql/types.js';
import type { ToolDefinition, ToolResult } from '../core/types.js';
import type { PortfolioSnapshotStore } from '../portfolio/snapshot-store.js';
import { PlatformSchema } from '../scraper/types.js';
import { balanceToRange, quantityToRange } from '../trust/pii/patterns.js';

const PositionInputSchema = z.object({
  symbol: z.string().min(1).describe('Ticker symbol (e.g. AAPL, BTC)'),
  name: z.string().default('').describe('Full name of the asset'),
  quantity: z.number().default(0).describe('Number of shares/units held'),
  costBasis: z.number().default(0).describe('Average cost per share/unit'),
  currentPrice: z.number().default(0).describe('Current price per share/unit'),
  marketValue: z.number().default(0).describe('Total market value of the position'),
  unrealizedPnl: z.number().default(0).describe('Unrealized profit/loss'),
  unrealizedPnlPercent: z.number().default(0).describe('Unrealized P&L as a percentage'),
  sector: z.string().optional().describe('Sector (e.g. Technology, Healthcare)'),
  assetClass: AssetClassSchema.default('OTHER').describe('Asset class'),
});

export interface PortfolioToolsOptions {
  snapshotStore: PortfolioSnapshotStore;
}

export function createPortfolioTools(options: PortfolioToolsOptions): ToolDefinition[] {
  const { snapshotStore } = options;

  const savePositions: ToolDefinition = {
    name: 'save_portfolio_positions',
    description:
      'Save portfolio positions extracted from a screenshot or user input. ' +
      'Call this whenever a user shares a portfolio screenshot or provides position data. ' +
      'This persists the positions so the user can track their portfolio over time.',
    parameters: z.object({
      platform: PlatformSchema.describe('Platform the positions were imported from'),
      positions: z.array(PositionInputSchema).min(1).describe('Array of positions to save'),
    }),
    async execute(params: {
      platform: Platform;
      positions: Array<z.infer<typeof PositionInputSchema>>;
    }): Promise<ToolResult> {
      const positions: Position[] = params.positions.map((p) => ({
        symbol: p.symbol.toUpperCase(),
        name: p.name,
        quantity: p.quantity,
        costBasis: p.costBasis,
        currentPrice: p.currentPrice,
        marketValue: p.marketValue || p.quantity * p.currentPrice,
        unrealizedPnl: p.unrealizedPnl || (p.currentPrice - p.costBasis) * p.quantity,
        unrealizedPnlPercent:
          p.unrealizedPnlPercent || (p.costBasis > 0 ? ((p.currentPrice - p.costBasis) / p.costBasis) * 100 : 0),
        sector: p.sector,
        assetClass: p.assetClass as AssetClass,
        platform: params.platform,
      }));

      const snapshot = await snapshotStore.save({
        positions,
        platform: params.platform,
      });

      // Redact exact values — the LLM should not see real balances.
      // The UI reads exact values directly from the snapshot store via GraphQL.
      return {
        content:
          `Portfolio saved successfully.\n` +
          `Snapshot ID: ${snapshot.id}\n` +
          `Platform: ${params.platform}\n` +
          `Positions: ${positions.length}\n` +
          `Total Value: ${balanceToRange(snapshot.totalValue)}\n` +
          `Total P&L: ${snapshot.totalPnl < 0 ? '-' : '+'}${balanceToRange(snapshot.totalPnl)}`,
      };
    },
  };

  const getPortfolio: ToolDefinition = {
    name: 'get_portfolio',
    description:
      'Get the current portfolio positions. Returns the latest saved snapshot ' +
      'with all positions, totals, and metadata.',
    parameters: z.object({}),
    async execute(): Promise<ToolResult> {
      const snapshot = await snapshotStore.getLatest();
      if (!snapshot) {
        return {
          content: 'No portfolio data found. The user has not imported any positions yet.',
        };
      }

      // Redact exact values — the LLM sees symbols, bucketed quantities, and balance
      // ranges but NOT exact dollar amounts or quantities. The UI shows real values via GraphQL.
      const summary = snapshot.positions
        .map(
          (p) =>
            `  ${p.symbol}: ${quantityToRange(p.quantity)}, value: ${balanceToRange(p.marketValue)} ` +
            `(P&L: ${p.unrealizedPnlPercent >= 0 ? '+' : ''}${p.unrealizedPnlPercent.toFixed(1)}%)`,
        )
        .join('\n');

      return {
        content:
          `Portfolio (${snapshot.platform ?? 'ALL'}) — ${snapshot.timestamp}\n` +
          `Positions:\n${summary}\n\n` +
          `Total Value: ${balanceToRange(snapshot.totalValue)}\n` +
          `Total P&L: ${snapshot.totalPnlPercent.toFixed(1)}%`,
      };
    },
  };

  return [savePositions, getPortfolio];
}
