import type { AgentProfile } from '../types.js';

export function createResearchAnalystProfile(): AgentProfile {
  return {
    id: 'research-analyst',
    name: 'Research Analyst',
    role: 'analyst',
    description: 'Jintel-backed market intelligence — gathers, validates, and structures data for downstream agents.',
    tools: [
      // Jintel tools
      'search_entities',
      'jintel_query',
      'enrich_entity',
      'enrich_position',
      'enrich_snapshot',
      'batch_enrich',
      'market_quotes',
      'price_history',
      'run_technical',
      'sanctions_screen',
      'get_news',
      'get_research',
      'get_sentiment',
      'get_derivatives',
      'get_short_interest',
      'get_fama_french',
      'get_social',
      'get_predictions',
      'get_discussions',
      'get_financials',
      'get_executives',
      'get_institutional_holdings',
      'get_ownership',
      'get_top_holders',
      'get_gdp',
      'get_inflation',
      'get_interest_rates',
      'get_sp500_multiples',
      // Signal tools
      'glob_signals',
      'grep_signals',
      'read_signal',
      // Health
      'check_api_health',
      // Memory tools
      'store_signal_memory',
      'recall_signal_memories',
      // Watchlist
      'watchlist_add',
      'watchlist_remove',
      'watchlist_list',
      // Utility
      'get_current_time',
      'calculate',
    ],
    allowedActions: ['tool_call', 'network_request'],
    capabilities: ['market-data', 'technicals', 'signals', 'enrichment', 'symbol-resolution'],
  };
}
