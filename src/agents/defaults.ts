/**
 * Default agent profiles — factory for the four Yojin agents.
 *
 * Tool names are forward-declared strings. ToolRegistry.subset() silently
 * skips unregistered names, so profiles can reference tools before they exist.
 */

import type { AgentProfile } from './types.js';

export function createDefaultProfiles(): AgentProfile[] {
  return [
    {
      id: 'research-analyst',
      name: 'Research Analyst',
      role: 'analyst',
      description: 'Data gatherer — queries data sources, runs technicals, enriches positions.',
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
    },
    {
      id: 'strategist',
      name: 'Strategist',
      role: 'strategist',
      description: 'Decision-maker — synthesizes research and risk into portfolio intelligence.',
      tools: [
        // Brain tools (Strategist-only)
        'brain_get_memory',
        'brain_update_memory',
        'brain_get_emotion',
        'brain_update_emotion',
        'brain_get_persona',
        'brain_get_log',
        'brain_rollback',
        // Portfolio reasoning (Strategist-only)
        'portfolio_reasoning',
        // Security audit
        'security_audit_check',
        // Utility
        'get_current_time',
        'calculate',
      ],
      allowedActions: ['tool_call'],
      capabilities: ['reasoning', 'memory', 'emotion', 'persona', 'recommendations'],
    },
    {
      id: 'risk-manager',
      name: 'Risk Manager',
      role: 'risk-manager',
      description: 'Guardian — analyzes portfolio risk, flags concentration and correlation.',
      tools: [
        // Risk tools
        'analyze_exposure',
        'score_concentration',
        'detect_correlations',
        'check_earnings_calendar',
        'track_drawdown',
        // Security audit
        'security_audit_check',
        // Diagnostics
        'diagnose_data_error',
        'check_api_health',
        // Utility
        'get_current_time',
        'calculate',
      ],
      allowedActions: ['tool_call'],
      capabilities: ['exposure-analysis', 'concentration', 'correlation', 'earnings', 'drawdown'],
    },
    {
      id: 'trader',
      name: 'Trader',
      role: 'trader',
      description: 'Executor — connects to platforms, fetches positions, manages connections.',
      tools: [
        // Platform tools
        'connect_platform',
        'disconnect_platform',
        'list_platforms',
        'fetch_positions',
        'check_platform_health',
        // Credential tools
        'check_credential',
        'list_credentials',
        // Diagnostics
        'diagnose_data_error',
        // Utility
        'get_current_time',
        'calculate',
      ],
      allowedActions: ['tool_call', 'network_request'],
      capabilities: ['platform-connection', 'position-fetching', 'trade-execution'],
    },
  ];
}
