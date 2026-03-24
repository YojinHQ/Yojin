import type { AgentProfile } from '../types.js';

export function createResearchAnalystProfile(): AgentProfile {
  return {
    id: 'research-analyst',
    name: 'Research Analyst',
    role: 'analyst',
    description: 'Market intelligence — gathers, validates, and structures data from connected sources.',
    tools: [
      // Jintel tools
      'search_entities',
      'enrich_entity',
      'market_quotes',
      'news_search',
      'sanctions_screen',
      'web_search',
      // Signal tools
      'glob_signals',
      'grep_signals',
      'read_signal',
      // Enrichment (future — wired in FE integration story)
      'enrich_position',
      'enrich_snapshot',
      // Research / technicals
      'run_technical',
      'resolve_symbol',
      // Data source
      'query_data_source',
      'list_data_sources',
      // Health
      'check_api_health',
      // Memory tools
      'store_signal_memory',
      'recall_signal_memories',
      // Watchlist
      'watchlist.add',
      'watchlist.remove',
      'watchlist.list',
      // Utility
      'get_current_time',
      'calculate',
    ],
    allowedActions: ['tool_call', 'network_request'],
    capabilities: ['market-data', 'technicals', 'signals', 'enrichment', 'symbol-resolution'],
  };
}
