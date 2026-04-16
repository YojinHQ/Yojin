/**
 * Signal agent tools — glob_signals, grep_signals, read_signal.
 *
 * These are registered with ToolRegistry and scoped to the Research Analyst agent.
 * They search the signal archive, which stores data from any connected DataSourcePlugin.
 */

import { z } from 'zod';

import type { SignalArchive } from './archive.js';
import type { Signal, SignalType } from './types.js';
import { SignalTypeSchema } from './types.js';
import type { ToolDefinition, ToolResult } from '../core/types.js';

export interface SignalToolsOptions {
  archive: SignalArchive;
}

const DEFAULT_SINCE_DAYS: Partial<Record<SignalType, number>> = {
  [SignalTypeSchema.enum.FUNDAMENTAL]: 7,
  [SignalTypeSchema.enum.TECHNICAL]: 7,
  [SignalTypeSchema.enum.NEWS]: 3,
  [SignalTypeSchema.enum.SENTIMENT]: 3,
  [SignalTypeSchema.enum.SOCIALS]: 3,
};

function resolveSince(type: SignalType | undefined, since: string | undefined): string | undefined {
  if (since) return since;
  if (!type) return undefined;
  const days = DEFAULT_SINCE_DAYS[type];
  if (days === undefined) return undefined;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function createSignalTools(options: SignalToolsOptions): ToolDefinition[] {
  const { archive } = options;

  const globSignals: ToolDefinition = {
    name: 'glob_signals',
    description:
      'List available signal dates. Use this to discover what ' +
      'signal data is available before drilling into specifics.',
    parameters: z.object({}),
    async execute(): Promise<ToolResult> {
      const dates = await archive.listDates();
      if (dates.length === 0) {
        return { content: 'No signals in archive.' };
      }
      return {
        content: `Available signal dates (${dates.length}):\n${dates.join('\n')}`,
      };
    },
  };

  const grepSignals: ToolDefinition = {
    name: 'grep_signals',
    description:
      'Search signals by type, ticker(s), date range, source, or text. ' +
      'Supports batch lookup: pass `tickers` array to search multiple symbols in ONE call ' +
      '(results grouped by ticker). Returns signal summaries (id, title, type, tickers, date).',
    parameters: z.object({
      type: SignalTypeSchema.optional().describe(
        'Signal type (one of: NEWS, FUNDAMENTAL, SENTIMENT, TECHNICAL, MACRO, FILINGS, SOCIALS, REGULATORY, DISCLOSED_TRADE, TRADING_LOGIC_TRIGGER)',
      ),
      ticker: z.string().optional().describe('Filter by single ticker symbol (e.g. AAPL)'),
      tickers: z
        .array(z.string().min(1))
        .min(1)
        .max(50)
        .optional()
        .describe('Filter by multiple tickers at once (e.g. ["AAPL","MSFT","GOOG"]). Takes precedence over ticker.'),
      sourceId: z.string().optional().describe('Filter by data source ID'),
      since: z
        .string()
        .optional()
        .describe(
          'ISO date — signals on or after this date. ' +
            'When omitted, time-sensitive types are clamped automatically: FUNDAMENTAL/TECHNICAL → 7 days, ' +
            'NEWS/SENTIMENT/SOCIALS → 3 days. Other types (MACRO, FILINGS, …) return full history. ' +
            'Pass an explicit old date to override (e.g. to backtest or audit).',
        ),
      until: z.string().optional().describe('ISO date — signals on or before this date'),
      search: z.string().optional().describe('Text search in title and content'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe('Max results per ticker (when using tickers array) or total'),
    }),
    async execute(params: {
      type?: SignalType;
      ticker?: string;
      tickers?: string[];
      sourceId?: string;
      since?: string;
      until?: string;
      search?: string;
      limit: number;
    }): Promise<ToolResult> {
      const effectiveSince = resolveSince(params.type, params.since);

      // Batch mode: single query for all tickers, then group in memory
      if (params.tickers) {
        const allSignals = await archive.query({
          type: params.type,
          tickers: params.tickers,
          sourceId: params.sourceId,
          since: effectiveSince,
          until: params.until,
          search: params.search,
          limit: params.limit * params.tickers.length,
        });

        // Group by ticker, enforce per-ticker limit
        const tickerSet = new Set(params.tickers);
        const byTicker = new Map<string, Signal[]>();
        for (const signal of allSignals) {
          for (const asset of signal.assets) {
            if (tickerSet.has(asset.ticker)) {
              const group = byTicker.get(asset.ticker) ?? [];
              if (group.length < params.limit) {
                group.push(signal);
                byTicker.set(asset.ticker, group);
              }
            }
          }
        }

        if (byTicker.size === 0) {
          return { content: `No signals found for tickers: ${params.tickers.join(', ')}` };
        }

        const sections: string[] = [];
        for (const ticker of params.tickers) {
          const group = byTicker.get(ticker);
          if (!group || group.length === 0) {
            sections.push(`## ${ticker}\nNo signals found.`);
            continue;
          }
          // Deduplicate (a signal can appear in multiple ticker groups)
          const seen = new Set<string>();
          const unique = group.filter((s) => {
            if (seen.has(s.id)) return false;
            seen.add(s.id);
            return true;
          });
          const lines = unique.map((s) => formatSignalSummary(s));
          sections.push(
            `## ${ticker} (${unique.length} signal${unique.length !== 1 ? 's' : ''})\n${lines.join('\n\n')}`,
          );
        }

        return { content: sections.join('\n\n') };
      }

      // Single-ticker mode (original behavior)
      const signals = await archive.query({
        type: params.type,
        ticker: params.ticker,
        sourceId: params.sourceId,
        since: effectiveSince,
        until: params.until,
        search: params.search,
        limit: params.limit,
      });

      if (signals.length === 0) {
        return { content: 'No signals match your search.' };
      }

      const lines = signals.map((s) => formatSignalSummary(s));
      return {
        content: `Found ${signals.length} signal(s):\n\n${lines.join('\n\n')}`,
      };
    },
  };

  const readSignal: ToolDefinition = {
    name: 'read_signal',
    description: 'Read the full content of a specific signal by ID. ' + 'Use grep_signals first to find signal IDs.',
    parameters: z.object({
      id: z.string().min(1).describe('Signal ID from grep_signals results'),
    }),
    async execute(params: { id: string }): Promise<ToolResult> {
      const signal = await archive.getById(params.id);
      if (!signal) {
        return { content: `Signal not found: ${params.id}`, isError: true };
      }

      return {
        content: formatSignalFull(signal),
      };
    },
  };

  return [globSignals, grepSignals, readSignal];
}

function formatSignalSummary(s: Signal): string {
  const tickers = s.assets.length > 0 ? ` [${s.assets.map((a) => a.ticker).join(', ')}]` : '';
  const sources = s.sources.map((src) => src.id).join(', ');
  const link = typeof s.metadata?.link === 'string' ? `\n  link: ${s.metadata.link}` : '';
  return `**${s.id}** [${s.type}] — ${s.title}${tickers}\n  ${s.publishedAt} | sources: ${sources}${link}`;
}

function formatSignalFull(s: Signal): string {
  const link = typeof s.metadata?.link === 'string' ? s.metadata.link : null;
  const parts = [
    `# ${s.title}`,
    `ID: ${s.id}`,
    `Type: ${s.type}`,
    `Published: ${s.publishedAt}`,
    `Ingested: ${s.ingestedAt}`,
    `Confidence: ${s.confidence}`,
    link ? `Link: ${link}` : null,
    s.assets.length > 0
      ? `Assets: ${s.assets.map((a) => `${a.ticker} (${a.linkType}, relevance: ${a.relevance})`).join(', ')}`
      : null,
    `Sources: ${s.sources.map((src) => `${src.name} (${src.type})`).join(', ')}`,
    s.metadata ? `Metadata: ${JSON.stringify(s.metadata)}` : null,
    '',
    s.content ?? '(no content)',
  ];
  return parts.filter((p) => p !== null).join('\n');
}
