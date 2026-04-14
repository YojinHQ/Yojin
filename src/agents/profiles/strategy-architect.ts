import type { AgentProfile } from '../types.js';

export function createStrategyArchitectProfile(): AgentProfile {
  return {
    id: 'strategy-architect',
    name: 'Strategy Architect',
    role: 'strategist',
    description: 'Strategy Studio expert — designs and refines trading strategies via display_propose_strategy.',
    tools: [
      // Primary action — the only way to populate the studio form
      'display_propose_strategy',
      // Read-only strategy lookups (for fork/edit context)
      'list_strategies',
      'get_strategy',
      // Entity + ownership lookups (copy-trading, index research)
      'search_entities',
      'get_institutional_holdings',
      'get_top_holders',
      'get_ownership',
      // Market & technical context
      'market_quotes',
      'price_history',
      'run_technical',
      'enrich_entity',
      'get_financials',
      'get_news',
      'get_research',
      'get_sentiment',
      // Read-only portfolio context (for personalisation)
      'get_portfolio',
      // Utility
      'get_current_time',
      'calculate',
    ],
    allowedActions: ['tool_call', 'network_request'],
    capabilities: ['strategy-design', 'archetype-recognition', 'copy-trading-research'],
  };
}
