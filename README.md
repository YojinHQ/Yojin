# Yojin

Personal Bloomberg for retail investors. An AI finance agent that runs locally on your laptop, connects to your investment accounts, and delivers personalized portfolio intelligence.

## What It Does

- **Scrapes your portfolios** — Playwright automation logs into Polymarket, Robinhood, Coinbase, and more to extract your live positions
- **Enriches with intelligence** — Dual-source enrichment via Keelson API (social sentiment, prediction market context) and OpenBB SDK (fundamentals, price data, technicals)
- **Analyzes risk** — Sector exposure, concentration scoring, correlated position detection, earnings calendar overlay
- **Delivers alerts** — Morning digests, intraday alerts for price moves, sentiment shifts, earnings proximity, and concentration drift
- **Talks to you** — Multi-channel delivery via Slack, Telegram, Web UI, or Claude Desktop (MCP)

## Architecture

Four specialized AI agents collaborate through shared state:

| Agent | Role |
|-------|------|
| **Research Analyst** | Gathers market data via OpenBB SDK, enriches positions, searches news |
| **Strategist** | Reads persona + data + risk reports, produces recommendations and alerts |
| **Risk Manager** | Analyzes portfolio exposure, concentration, correlation, drawdown |
| **Trader** | Scrapes platforms, tracks positions, executes trades (Phase 2) |

All state is file-driven — JSONL sessions, JSON configs, Markdown personas. No database, no containers.

```
User → AgentRuntime → Orchestrator
                        ├── Trader.scrape() → PortfolioSnapshot
                        ├── Research.enrich() → EnrichedSnapshot
                        ├── Risk.analyze() → RiskReport
                        └── Strategist.reason() → Recommendation → Channels
```

## Quick Start

### Prerequisites

- Node.js >= 20
- pnpm 10+

### Install

```bash
pnpm install
```

### Configure

```bash
# Set up your AI provider (pick one)
export ANTHROPIC_API_KEY=sk-ant-...
# or
pnpm dev -- setup-token  # OAuth flow for Claude Code CLI
```

### Run

```bash
# Development
pnpm dev

# Interactive chat
pnpm chat

# Production
pnpm build && pnpm start
```

## Project Structure

```
yojin/
├── src/
│   ├── core/           # Agent runtime — AgentRuntime, ToolRegistry, ProviderRouter
│   ├── agents/         # Multi-agent profiles and orchestrator
│   ├── brain/          # Strategist's persistent memory and persona
│   ├── openbb/         # TypeScript-native market data SDK (in-process)
│   ├── research/       # Equity research tools, technicals, reasoning tools
│   ├── news/           # RSS collector + real-time news API
│   ├── scraper/        # Playwright automation for investment platforms
│   ├── enrichment/     # Dual-source enrichment (Keelson + OpenBB)
│   ├── risk/           # Portfolio risk analysis (exposure, concentration)
│   ├── guards/         # Agent safety — guard pipeline
│   ├── trust/          # Credentials, PII redaction, action boundaries
│   ├── alerts/         # Alert engine and morning digest builder
│   ├── tools/          # Agent tools registered with ToolRegistry
│   └── plugins/        # Plugin system (ProviderPlugin, ChannelPlugin)
├── providers/          # LLM providers (anthropic/)
├── channels/           # Messaging channels (slack/, telegram/, web/)
├── packages/           # Shared packages (keelson-client/)
├── data/               # Runtime state — JSONL, configs, snapshots (gitignored)
├── plans/              # Architecture documentation
└── test/               # Test suites
```

## Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development server (tsx) |
| `pnpm chat` | Interactive chat REPL |
| `pnpm build` | Compile TypeScript |
| `pnpm start` | Run compiled output |
| `pnpm test` | Run tests (vitest) |
| `pnpm lint` | Lint with ESLint |
| `pnpm clean` | Remove dist/ |

## Channels

| Channel | Status |
|---------|--------|
| Slack | Working (@slack/bolt) |
| Telegram | Phase 1 (grammy) |
| Web UI | Phase 1 (Hono + SSE) |
| MCP | Phase 1 (Claude Desktop / Cursor) |
| Discord | Future |

## Tech Stack

- **TypeScript** — strict mode, ESM, Node.js 20+
- **Anthropic SDK** — Claude as the default AI provider
- **Playwright** — browser automation for scraping investment platforms
- **Zod** — schema validation for all external data
- **vitest** — testing
- **tslog** — structured logging
- **pnpm** — package manager

## Persona

Yojin's behavior is driven by a Markdown persona file. Edit `data/brain/persona.md` to change how the agent thinks:

```markdown
# Persona: Conservative Portfolio Analyst

I focus on risk-adjusted returns and concentration risk.
When any single position exceeds 25% of portfolio, I flag it immediately.
I never recommend more than 10% of portfolio in prediction markets.
```

No code changes needed — the agent adapts on the next request.

## Phase 1 MVP

Prediction market intelligence (Polymarket only):

1. Polymarket position scraping
2. Keelson + OpenBB enrichment
3. Multi-channel alerts (Slack, Telegram, Web)
4. MCP server for Claude Desktop
5. Persona-driven reasoning
6. Morning digest + intraday alerts

## License

MIT
