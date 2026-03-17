import AgentCard from '../components/agents/AgentCard';

const agents = [
  {
    name: 'Research Analyst',
    role: 'Data & Analysis',
    description:
      'Gathers market data via OpenBB SDK, runs technical analysis, and enriches positions with Keelson sentiment data.',
    status: 'idle' as const,
  },
  {
    name: 'Strategist',
    role: 'Decision Making',
    description:
      'Maintains persistent cognitive state (persona, working memory, emotion). Synthesizes research into investment theses.',
    status: 'idle' as const,
  },
  {
    name: 'Risk Manager',
    role: 'Risk Assessment',
    description:
      'Analyzes portfolio exposure, concentration risk, cross-asset correlation, and monitors earnings calendar for events.',
    status: 'idle' as const,
  },
  {
    name: 'Trader',
    role: 'Execution',
    description:
      'Manages browser automation for investment platforms. Handles login, position tracking, and order execution.',
    status: 'idle' as const,
  },
];

export default function Agents() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">AI Agents</h2>
        <p className="mt-1 text-sm text-slate-400">
          Monitor and manage the four specialized AI agents that power Yojin's portfolio
          intelligence.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {agents.map((agent) => (
          <AgentCard key={agent.name} {...agent} />
        ))}
      </div>
    </div>
  );
}
