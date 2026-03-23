import { z } from 'zod';

import { WatchlistEnrichment } from './watchlist-enrichment.js';
import { WatchlistStore } from './watchlist-store.js';
import { AssetClassSchema } from '../api/graphql/types.js';
import type { AssetClass } from '../api/graphql/types.js';
import type { ToolDefinition, ToolResult } from '../core/types.js';
import type { JintelClient } from '../jintel/client.js';
import { getLogger } from '../logging/index.js';

const log = getLogger().sub('watchlist-adapter');

export interface WireWatchlistOptions {
  dataDir: string;
  jintelClient?: JintelClient;
  ttlSeconds?: number;
}

export interface WireWatchlistResult {
  store: WatchlistStore;
  enrichment: WatchlistEnrichment;
  tools: ToolDefinition[];
}

export async function wireWatchlist(options: WireWatchlistOptions): Promise<WireWatchlistResult> {
  const { dataDir, jintelClient, ttlSeconds } = options;

  const store = new WatchlistStore({ dataDir });
  await store.initialize();

  const enrichment = new WatchlistEnrichment({
    store,
    jintelClient,
    dataDir,
    ttlSeconds,
  });
  await enrichment.initialize();

  const tools = createWatchlistTools({ store, enrichment, jintelClient });

  return { store, enrichment, tools };
}

function createWatchlistTools(deps: {
  store: WatchlistStore;
  enrichment: WatchlistEnrichment;
  jintelClient?: JintelClient;
}): ToolDefinition[] {
  const { store, enrichment, jintelClient } = deps;

  const addTool: ToolDefinition = {
    name: 'watchlist.add',
    description: 'Add a symbol to the watchlist. Resolves company name and enriches via Jintel automatically.',
    parameters: z.object({
      symbol: z.string().describe('Ticker symbol, e.g. AAPL, BTC'),
      assetClass: AssetClassSchema.describe('Asset class: EQUITY, CRYPTO, BOND, COMMODITY, CURRENCY, or OTHER'),
      name: z.string().optional().describe('Company/asset name. Auto-resolved from Jintel if omitted.'),
    }),
    async execute(params): Promise<ToolResult> {
      const symbol = (params.symbol as string).toUpperCase();
      let name = params.name as string | undefined;

      // Auto-resolve name and entity ID via Jintel
      let resolvedEntityId: string | undefined;
      if (!name && jintelClient) {
        const searchResult = await jintelClient.searchEntities(symbol, { limit: 1 });
        if (searchResult.success && searchResult.data.length > 0) {
          name = searchResult.data[0].name;
          resolvedEntityId = searchResult.data[0].id;
        }
      }

      if (!name) {
        return { content: `Could not resolve name for ${symbol}. Please provide the name explicitly.`, isError: true };
      }

      const result = await store.add({
        symbol,
        name,
        assetClass: params.assetClass as AssetClass,
        jintelEntityId: resolvedEntityId,
      });

      if (!result.success) {
        return { content: result.error, isError: true };
      }

      // Best-effort: eager enrichment (entity already resolved above if possible)
      try {
        if (!resolvedEntityId) {
          await enrichment.resolveEntity(symbol);
        }
        await enrichment.enrichSymbol(symbol);
      } catch (err) {
        log.warn('Enrichment failed after add', { symbol, error: String(err) });
      }

      return { content: `Added ${symbol} (${name}) to watchlist.` };
    },
  };

  const removeTool: ToolDefinition = {
    name: 'watchlist.remove',
    description: 'Remove a symbol from the watchlist.',
    parameters: z.object({
      symbol: z.string().describe('Ticker symbol to remove'),
    }),
    async execute(params): Promise<ToolResult> {
      const symbol = (params.symbol as string).toUpperCase();
      const result = await store.remove(symbol);

      if (!result.success) {
        return { content: result.error, isError: true };
      }

      // Clean up enrichment cache
      try {
        await enrichment.removeCache(symbol);
      } catch (err) {
        log.warn('Cache cleanup failed after remove', { symbol, error: String(err) });
      }

      return { content: `Removed ${symbol} from watchlist.` };
    },
  };

  const listTool: ToolDefinition = {
    name: 'watchlist.list',
    description: 'List all watchlist symbols with enrichment data (quote, news, risk score).',
    parameters: z.object({}),
    async execute(): Promise<ToolResult> {
      const entries = store.list();
      if (entries.length === 0) {
        return { content: 'Watchlist is empty.' };
      }

      const lines: string[] = [];
      for (const entry of entries) {
        const cached = await enrichment.getEnriched(entry.symbol);
        let line = `**${entry.symbol}** — ${entry.name} (${entry.assetClass})`;

        if (cached?.quote) {
          const q = cached.quote;
          const direction = q.change >= 0 ? '+' : '';
          line += `\n  Price: $${q.price} (${direction}${q.changePercent.toFixed(2)}%)`;
        }

        if (cached?.riskScore != null) {
          line += `\n  Risk Score: ${cached.riskScore}/100`;
        }

        if (cached?.news && cached.news.length > 0) {
          line += '\n  Recent News:';
          for (const article of cached.news) {
            line += `\n    - ${article.title} (${article.source})`;
          }
        }

        lines.push(line);
      }

      return { content: lines.join('\n\n') };
    },
  };

  return [addTool, removeTool, listTool];
}
