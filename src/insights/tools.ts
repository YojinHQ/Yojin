/**
 * Insight tools — agent tool for persisting ProcessInsights reports.
 *
 * The save_insight_report tool is registered for the Strategist agent only.
 * By exposing persistence as a tool, the TAO loop validates input via Zod
 * on call — if the schema fails, the agent gets an error observation and retries.
 */

import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import type { InsightStore } from './insight-store.js';
import {
  InsightRatingSchema,
  PortfolioHealthSchema,
  PortfolioInsightSchema,
  PositionInsightSchema,
  SignalImpactSchema,
} from './types.js';
import type { ToolDefinition, ToolResult } from '../core/types.js';
import { getLogger } from '../logging/index.js';
import type { SignalArchive } from '../signals/archive.js';

const log = getLogger().sub('insight-tools');

export interface InsightToolsOptions {
  insightStore: InsightStore;
  signalArchive?: SignalArchive;
}

export function createInsightTools(options: InsightToolsOptions): ToolDefinition[] {
  const { insightStore, signalArchive } = options;

  const saveInsightReport: ToolDefinition = {
    name: 'save_insight_report',
    description:
      'Save a structured insight report after analyzing the portfolio. ' +
      'Call this at the end of the ProcessInsights workflow with per-position ' +
      'ratings, portfolio-level synthesis, and your current emotional state. ' +
      'IMPORTANT: Include the source URL for each key signal so users can verify the data.',
    parameters: z.object({
      snapshotId: z.string().min(1).describe('ID of the portfolio snapshot this analysis is based on'),
      positions: z
        .array(
          z.object({
            symbol: z.string().min(1).describe('Ticker symbol'),
            name: z.string().describe('Asset name'),
            rating: InsightRatingSchema.describe('Rating: STRONG_BUY, BUY, HOLD, SELL, or STRONG_SELL'),
            conviction: z.number().min(0).max(1).describe('Conviction level 0-1'),
            thesis: z.string().min(1).describe('2-3 sentence investment thesis'),
            keySignals: z
              .array(
                z.object({
                  signalId: z
                    .string()
                    .min(1)
                    .describe(
                      'Exact signal ID from grep_signals output (e.g. sig-abc123). Must match an archived signal.',
                    ),
                  type: z.string().min(1).describe('Signal type (NEWS, FUNDAMENTAL, etc.)'),
                  title: z.string().min(1).describe('Signal title'),
                  impact: SignalImpactSchema.describe('Impact: POSITIVE, NEGATIVE, or NEUTRAL'),
                  confidence: z.number().min(0).max(1).describe('Signal confidence'),
                  url: z.string().nullable().optional().describe('Source URL for this signal'),
                }),
              )
              .describe('Key signals that informed this rating'),
            risks: z.array(z.string().min(1)).describe('Risk factors'),
            opportunities: z.array(z.string().min(1)).describe('Opportunity factors'),
            memoryContext: z.string().nullable().describe('Summary of relevant past memories'),
            priceTarget: z.number().nullable().describe('Optional price target'),
          }),
        )
        .min(1)
        .describe('Per-position insights'),
      portfolio: z
        .object({
          overallHealth: PortfolioHealthSchema.describe('Overall: STRONG, HEALTHY, CAUTIOUS, WEAK, or CRITICAL'),
          summary: z.string().min(1).describe('3-5 sentence portfolio overview'),
          sectorThemes: z.array(z.string()).describe('Key sector-level observations'),
          macroContext: z.string().describe('Macro environment summary'),
          topRisks: z.array(z.string()).describe('Portfolio-level risk factors'),
          topOpportunities: z.array(z.string()).describe('Portfolio-level opportunities'),
          actionItems: z.array(z.string()).describe('Concrete next steps'),
        })
        .describe('Portfolio-level synthesis'),
      emotionState: z
        .object({
          confidence: z.number().min(0).max(1).describe('Your confidence level after analysis'),
          riskAppetite: z.number().min(0).max(1).describe('Your risk appetite after analysis'),
          reason: z.string().describe('Why you feel this way'),
        })
        .describe('Your emotional state after completing the analysis'),
    }),
    async execute(params: {
      snapshotId: string;
      positions: z.infer<typeof PositionInsightSchema>[];
      portfolio: {
        overallHealth: string;
        summary: string;
        sectorThemes: string[];
        macroContext: string;
        topRisks: string[];
        topOpportunities: string[];
        actionItems: string[];
      };
      emotionState: { confidence: number; riskAppetite: number; reason: string };
    }): Promise<ToolResult> {
      const startMs = Date.now();

      // Validate position schemas
      const positions = params.positions.map((p) => PositionInsightSchema.parse(p));

      // Enrich position keySignals with canonical data from archive.
      // Drop signals that belong to a different position (LLM misattribution).
      let enrichedCount = 0;
      let droppedCount = 0;
      if (signalArchive) {
        for (const position of positions) {
          const baseSymbol = position.symbol.split('-')[0].toUpperCase();
          const validSignals = [];

          for (const sig of position.keySignals) {
            const archived = await signalArchive.getById(sig.signalId);
            if (!archived) {
              droppedCount++;
              log.warn(`Dropping signal with non-existent ID: ${sig.signalId} ("${sig.title}")`);
              continue;
            }
            const signalTickers = archived.assets.map((a) => a.ticker.split('-')[0].toUpperCase());
            if (signalTickers.length > 0 && !signalTickers.includes(baseSymbol)) {
              droppedCount++;
              log.warn('Dropped misattributed signal', {
                signalId: sig.signalId,
                signalTickers,
                positionSymbol: position.symbol,
                signalTitle: archived.title,
              });
              continue;
            }
            sig.title = archived.title;
            sig.url = (typeof archived.metadata?.link === 'string' ? archived.metadata.link : null) ?? sig.url;
            enrichedCount++;
            validSignals.push(sig);
          }
          position.keySignals = validSignals;
        }
      }

      // Deterministically assign signalIds to portfolio items.
      // Build a symbol → signalIds map from validated position keySignals.
      const symbolToSignalIds = new Map<string, string[]>();
      for (const position of positions) {
        const baseSymbol = position.symbol.split('-')[0].toUpperCase();
        const ids = position.keySignals.map((s) => s.signalId);
        const existing = symbolToSignalIds.get(baseSymbol) ?? [];
        symbolToSignalIds.set(baseSymbol, [...existing, ...ids]);
      }
      const allSymbols = [...symbolToSignalIds.keys()];

      function assignSignalIds(text: string): string[] {
        const textUpper = text.toUpperCase();
        const mentioned = allSymbols.filter((sym) => {
          // Match only when the symbol appears as a whole word (not a substring of another word)
          const escaped = sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const re = new RegExp(`(?<![A-Z0-9])${escaped}(?![A-Z0-9])`);
          return re.test(textUpper);
        });
        if (mentioned.length === 0) return []; // no tickers mentioned = no signals
        return mentioned.flatMap((sym) => symbolToSignalIds.get(sym) ?? []);
      }

      // Convert plain strings → structured PortfolioItems with auto-assigned signalIds
      const portfolio = PortfolioInsightSchema.parse({
        ...params.portfolio,
        topRisks: params.portfolio.topRisks.map((text) => ({ text, signalIds: assignSignalIds(text) })),
        topOpportunities: params.portfolio.topOpportunities.map((text) => ({ text, signalIds: assignSignalIds(text) })),
        actionItems: params.portfolio.actionItems.map((text) => ({ text, signalIds: assignSignalIds(text) })),
      });

      const report = {
        id: `insight-${randomUUID().slice(0, 8)}`,
        snapshotId: params.snapshotId,
        positions,
        portfolio,
        agentOutputs: {
          researchAnalyst: '',
          riskManager: '',
          strategist: '',
        },
        emotionState: params.emotionState,
        createdAt: new Date().toISOString(),
        durationMs: Date.now() - startMs,
      };

      await insightStore.save(report);

      const enrichNote = enrichedCount > 0 ? `\nSignal enrichment: ${enrichedCount} matched` : '';
      const dropNote = droppedCount > 0 ? `, ${droppedCount} misattributed signals dropped` : '';
      const validationNote = signalArchive ? `${enrichNote}${dropNote}` : '';

      return {
        content:
          `Insight report saved.\n` +
          `Report ID: ${report.id}\n` +
          `Positions analyzed: ${positions.length}\n` +
          `Portfolio health: ${portfolio.overallHealth}\n` +
          `Action items: ${portfolio.actionItems.length}${validationNote}`,
      };
    },
  };

  return [saveInsightReport];
}
