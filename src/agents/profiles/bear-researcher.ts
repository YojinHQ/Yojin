import type { AgentProfile } from '../types.js';

export function createBearResearcherProfile(): AgentProfile {
  return {
    id: 'bear-researcher',
    name: 'Bear Researcher',
    role: 'analyst',
    description: 'Adversarial analyst — builds the strongest bearish case for each position.',
    tools: [
      // Read-only memory access (disabled in pre-aggregated flow)
      'recall_signal_memories',
    ],
    allowedActions: ['tool_call'],
    capabilities: ['reasoning', 'advocacy'],
  };
}
