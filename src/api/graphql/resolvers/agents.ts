/**
 * Agent resolvers — queries for agent status and brain (Strategist) state.
 *
 * Returns mock data for the four Yojin agents and the Strategist's brain state
 * (persona, working memory, emotion). Will be replaced with real AgentRuntime
 * and Brain state once wired into YojinContext.
 */

const mockAgents = [
  {
    id: 'research-analyst',
    name: 'Research Analyst',
    role: 'Equity research, fundamentals analysis, news monitoring',
    status: 'idle',
    lastActivity: new Date(Date.now() - 900_000).toISOString(),
    currentTask: null,
  },
  {
    id: 'strategist',
    name: 'Strategist',
    role: 'Portfolio strategy, hypothesis formation, decision making',
    status: 'active',
    lastActivity: new Date(Date.now() - 120_000).toISOString(),
    currentTask: 'Analyzing sector rotation signals',
  },
  {
    id: 'risk-manager',
    name: 'Risk Manager',
    role: 'Exposure analysis, concentration scoring, correlation detection',
    status: 'idle',
    lastActivity: new Date(Date.now() - 3600_000).toISOString(),
    currentTask: null,
  },
  {
    id: 'trader',
    name: 'Trader',
    role: 'Trade execution, platform interaction, order management',
    status: 'standby',
    lastActivity: new Date(Date.now() - 86400_000).toISOString(),
    currentTask: null,
  },
];

const mockBrainState = {
  persona:
    'Cautiously optimistic value investor with a bias toward quality tech and selective crypto exposure. Prefers data-driven decisions with a 6-12 month horizon.',
  workingMemory: [
    'Tech sector showing resilience despite rate uncertainty — AAPL and MSFT fundamentals remain strong',
    'BTC approaching previous ATH, monitoring for potential breakout or rejection',
    'Portfolio tech concentration (53%) is elevated — may want to trim on strength',
    'SPY overlap with individual holdings is high — consider replacing with sector-specific ETFs',
    'Next earnings: AAPL Q2 expected late April, MSFT Q3 expected late April',
  ],
  emotionState: {
    confidence: 0.72,
    riskAppetite: 0.55,
    rationale:
      'Moderately confident in current positions given strong fundamentals, but elevated concentration and macro uncertainty warrant caution on new entries.',
  },
  lastCommit: new Date(Date.now() - 3600_000).toISOString(),
};

export const agentResolvers = {
  Query: {
    agents: () => mockAgents,
    brainState: () => mockBrainState,
  },
};
