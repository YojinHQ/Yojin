import type { AgentProfile } from '../types.js';

export function createBullResearcherProfile(): AgentProfile {
  return {
    id: 'bull-researcher',
    name: 'Bull Researcher',
    role: 'analyst',
    description: 'Adversarial analyst — builds the strongest bullish case for each position.',
    tools: [
      // Read-only memory access (disabled in pre-aggregated flow)
      'recall_signal_memories',
    ],
    allowedActions: ['tool_call'],
    capabilities: ['reasoning', 'advocacy'],
  };
}
