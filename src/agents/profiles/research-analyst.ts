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
      // Signal tools
      'glob_signals',
      'grep_signals',
      'read_signal',
      // Research / technicals
      'run_technical',
      'resolve_symbol',
      // Enrichment
      'enrich_position',
      'enrich_snapshot',
      // Data source
      'query_data_source',
      'list_data_sources',
      // Health
      'check_api_health',
      // Memory tools
      'store_signal_memory',
      'recall_signal_memories',
      // Utility
      'get_current_time',
      'calculate',
    ],
    allowedActions: ['tool_call', 'network_request'],
    capabilities: ['market-data', 'technicals', 'signals', 'enrichment', 'symbol-resolution'],
  };
}
