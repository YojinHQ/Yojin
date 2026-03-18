import type { AgentProfile } from '../types.js';

export function createResearchAnalystProfile(): AgentProfile {
  return {
    id: 'research-analyst',
    name: 'Research Analyst',
    role: 'analyst',
    description: 'Market intelligence — gathers, validates, and structures data from connected sources.',
    tools: [
      // OpenBB tools
      'openbb_equity_quote',
      'openbb_equity_fundamentals',
      'openbb_equity_price',
      'openbb_crypto_quote',
      'openbb_currency_quote',
      'openbb_commodity_quote',
      'openbb_economy_indicators',
      // News tools
      'glob_news',
      'grep_news',
      'read_news',
      // Research / technicals
      'run_technical',
      'resolve_symbol',
      // Enrichment
      'enrich_position',
      'enrich_snapshot',
      // Data source
      'query_data_source',
      // Health
      'check_api_health',
      // Utility
      'get_current_time',
      'calculate',
    ],
    allowedActions: ['tool_call', 'network_request'],
    capabilities: ['market-data', 'technicals', 'news', 'enrichment', 'symbol-resolution'],
  };
}
