---
description: Rules for the multi-agent system and agent interactions
globs: ["src/agents/**/*.ts", "src/brain/**/*.ts", "src/core/agent-runtime.ts"]
---

# Agent Rules

## Agent Profiles
- Each agent has: `id`, `systemPrompt` (from Markdown), `tools` (subset of ToolRegistry), `allowedActions`, optional `provider`/`model` override.
- Agent system prompts live as Markdown files in `data/default/agents/` (defaults) and can be overridden.
- Agents are NOT separate processes — they're profiles within AgentRuntime that share the ProviderRouter.

## Agent Scoping
- Research Analyst: Jintel enrichment, equity research tools, news tools, technicals.
- Strategist: Brain (persona, memory, emotion), research results, risk reports. The only agent with persistent cognitive state.
- Risk Manager: Exposure analyzer, concentration scoring, correlation detection, earnings calendar, drawdown tracker.
- Trader: Scraper (Playwright), platform login/logout, position tracking, order execution (Phase 2).

## Brain (Strategist Only)
- The Brain belongs exclusively to the Strategist agent.
- Frontal lobe = working memory (hypotheses, observations, active reasoning).
- Emotion = confidence level + risk appetite with rationale.
- Commit history = git-like versioned snapshots at decision points.
- Other agents are stateless — they produce reports on demand.

## Orchestration
- The orchestrator in `src/agents/orchestrator.ts` triggers agents in sequence or parallel depending on the workflow.
- Standard flows: scheduled digest, user query analysis, trade execution.
- Agents communicate through shared state (PortfolioSnapshot → EnrichedSnapshot → RiskReport), not direct calls.
