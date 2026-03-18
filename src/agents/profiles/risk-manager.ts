import type { AgentProfile } from '../types.js';

export function createRiskManagerProfile(): AgentProfile {
  return {
    id: 'risk-manager',
    name: 'Risk Manager',
    role: 'risk-manager',
    description: 'Portfolio risk analysis — exposure, concentration, correlation, earnings proximity.',
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
  };
}
