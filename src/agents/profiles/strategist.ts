import type { AgentProfile } from '../types.js';

export function createStrategistProfile(): AgentProfile {
  return {
    id: 'strategist',
    name: 'Strategist',
    role: 'strategist',
    description: 'Decision-maker — synthesizes research, risk, and persona into recommendations.',
    tools: [
      // Brain tools (Strategist-only)
      'brain_get_memory',
      'brain_update_memory',
      'brain_get_emotion',
      'brain_update_emotion',
      'brain_get_persona',
      'brain_set_persona',
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
  };
}
