/**
 * Signal agent tools — glob_signals, grep_signals, read_signal.
 *
 * These are registered with ToolRegistry and scoped to the Research Analyst agent.
 * They search the signal archive, which stores data from any connected DataSourcePlugin.
 */

import { z } from 'zod';

import type { SignalArchive } from './archive.js';
import type { Signal } from './types.js';
import type { ToolDefinition, ToolResult } from '../core/types.js';

export interface SignalToolsOptions {
  archive: SignalArchive;
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
      'Search signals by type, ticker, date range, source, or text. ' +
      'Returns matching signal summaries (id, title, type, tickers, date).',
    parameters: z.object({
      type: z.string().optional().describe('Signal type: NEWS, FUNDAMENTAL, SENTIMENT, TECHNICAL, MACRO'),
      ticker: z.string().optional().describe('Filter by ticker symbol (e.g. AAPL)'),
      sourceId: z.string().optional().describe('Filter by data source ID'),
      since: z.string().optional().describe('ISO date — signals on or after this date'),
      until: z.string().optional().describe('ISO date — signals on or before this date'),
      search: z.string().optional().describe('Text search in title and content'),
      limit: z.number().int().min(1).max(100).default(20).describe('Max results'),
    }),
    async execute(params: {
      type?: string;
      ticker?: string;
      sourceId?: string;
      since?: string;
      until?: string;
      search?: string;
      limit: number;
    }): Promise<ToolResult> {
      const signals = await archive.query({
        type: params.type,
        ticker: params.ticker,
        sourceId: params.sourceId,
        since: params.since,
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
