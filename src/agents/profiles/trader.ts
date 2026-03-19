import type { AgentProfile } from '../types.js';

export function createTraderProfile(): AgentProfile {
  return {
    id: 'trader',
    name: 'Trader',
    role: 'trader',
    description: 'Execution — scrapes platforms, tracks positions, executes approved trades.',
    tools: [
      // Platform tools
      'connect_platform',
      'disconnect_platform',
      'list_connections',
      'fetch_positions',
      'check_platform_health',
      // Portfolio tools
      'save_portfolio_positions',
      'get_portfolio',
      // Credential tools
      'store_credential',
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
  };
}
