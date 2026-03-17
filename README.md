# Yojin

[![CI](https://github.com/YojinHQ/Yojin/actions/workflows/ci.yml/badge.svg)](https://github.com/YojinHQ/Yojin/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

A free, open-source AI agent that runs on your machine, connects to every platform and delivers personalized portfolio intelligence.

## What It Does

- **Scrapes your portfolios** — Playwright automation logs into Robinhood, Coinbase, IBKR, and more to extract your live positions
- **Enriches with intelligence** — Dual-source enrichment via Keelson API (social sentiment, news signals) and OpenBB SDK (fundamentals, price data, technicals)
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
┌─────────────────────────────────────────────────────────────────┐
│                         Your Machine                            │
│                                                                 │
│  ┌──────────┐    ┌──────────────┐    ┌───────────────────────┐  │
│  │ Robinhood │    │   AgentRuntime  │    │     Channels        │  │
│  │ Coinbase  │───▶│   Orchestrator  │───▶│  Slack / Telegram   │  │
│  │ IBKR      │    │                 │    │  Web UI / MCP       │  │
│  └──────────┘    └───────┬─────────┘    └───────────────────────┘  │
│                          │                                       │
│            ┌─────────────┼─────────────┐                        │
│            ▼             ▼             ▼                         │
│     ┌────────────┐ ┌──────────┐ ┌───────────┐                  │
│     │   Trader   │ │ Research │ │   Risk    │                   │
│     │  (scrape)  │ │ Analyst  │ │  Manager  │                   │
│     └─────┬──────┘ └────┬─────┘ └─────┬─────┘                  │
│           │              │             │                         │
│           ▼              ▼             ▼                         │
│    PortfolioSnapshot  EnrichedSnapshot  RiskReport               │
│           │              ▲             │                         │
│           │     ┌────────┴────────┐    │                         │
│           │     │   Enrichment    │    │                         │
│           └────▶│  Pipeline       │◀───┘                        │
│                 └───┬─────────┬───┘                              │
│                     │         │                                   │
│              ┌──────▼──┐ ┌───▼──────┐                           │
│              │ Keelson  │ │  OpenBB  │                           │
│              │   API    │ │   SDK    │                           │
│              │(sentiment│ │(in-proc) │                           │
│              └──────────┘ └──────────┘                           │
│                     │                                            │
│              ┌──────▼──────────┐                                │
│              │  Strategist     │                                 │
│              │  (persona.md)   │──▶ Alerts + Recommendations    │
│              │  Brain + Memory │                                 │
│              └─────────────────┘                                │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Trust Layer: secretctl │ RADIUS Guards │ PII │ Audit Log │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
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

# Web UI development
pnpm dev:web

# Backend + Web UI together
pnpm dev:all
```

## Project Structure

```
yojin/
├── src/
│   ├── core/           # Agent runtime
│   ├── agents/         # Multi-agent profiles and orchestrator
│   ├── brain/          # Strategist's persistent memory and persona
│   ├── openbb/         # TypeScript-native market data SDK
│   ├── research/       # Equity research tools, technicals
│   ├── news/           # RSS collector + real-time news API
│   ├── scraper/        # Playwright automation
│   ├── enrichment/     # Dual-source enrichment (Keelson + OpenBB)
│   ├── risk/           # Portfolio risk analysis
│   ├── guards/         # Agent safety — guard pipeline
│   ├── trust/          # Credentials, PII redaction, action boundaries
│   ├── alerts/         # Alert engine and morning digest
│   ├── api/            # GraphQL API (graphql-yoga on Hono)
│   ├── tools/          # Agent tools registered with ToolRegistry
│   └── plugins/        # Plugin system (ProviderPlugin, ChannelPlugin)
├── apps/
│   └── web/            # React web app (Vite + React 19 + Tailwind 4)
├── providers/          # LLM providers (anthropic/)
├── channels/           # Messaging channels (slack/, telegram/, web/)
├── packages/           # Shared packages (keelson-client/)
├── data/               # Runtime state (gitignored)
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
| `pnpm dev:web` | Start React web app (Vite dev server) |
| `pnpm dev:all` | Start backend + web app in parallel |
| `pnpm build:web` | Build React web app |
| `pnpm build:all` | Build all packages |
| `pnpm test:all` | Run tests across all packages |
| `pnpm ci:all` | Full CI check across all packages |

## Channels

| Channel | Status |
|---------|--------|
| Slack | Working (@slack/bolt) |
| Telegram | Phase 1 (grammy) |
| Web UI | In Progress (React 19 + GraphQL) |
| MCP | Phase 1 (Claude Desktop / Cursor) |
| Discord | Future |

## Security-First Approach

Yojin is built with security as a first-class concern — your credentials, portfolio data, and personal information are protected at every layer:

- **Encrypted credential vault** — All API keys and platform credentials stored in an AES-256-GCM encrypted JSON file via secretctl. Credentials are injected at the transport layer and never exposed to the LLM.
- **PII redaction** — Account IDs, exact balances, and personal identifiers are stripped before any data leaves your machine (e.g., Keelson API calls).
- **Deterministic guard pipeline** — Every agent action passes through RADIUS guards before execution. No LLM prompt tricks can bypass filesystem, network, or command restrictions.
- **Approval gate** — Irreversible actions (trades, new connections) require explicit human approval via your active channel.
- **Immutable audit log** — All security events (credential access, guard decisions, PII redaction, approvals) are logged to an append-only JSONL file that is never truncated.
- **Local-first** — Your data stays on your machine. No cloud database, no containers, no third-party data storage.

## Tech Stack

- **TypeScript** — strict mode, ESM, Node.js 20+
- **Anthropic SDK** — Claude as the default AI provider
- **Playwright** — browser automation for scraping investment platforms
- **Zod** — schema validation for all external data
- **vitest** — testing
- **tslog** — structured logging
- **React 19** — Web UI with Vite 6, Tailwind CSS 4
- **GraphQL** — graphql-yoga on Hono for API layer
- **urql** — Lightweight GraphQL client
- **pnpm** — package manager

## Persona

Yojin's behavior is driven by a Markdown persona file. Edit `data/brain/persona.md` to change how the agent thinks:

```markdown
# Persona: Conservative Portfolio Analyst

I focus on risk-adjusted returns and concentration risk.
When any single position exceeds 25% of portfolio, I flag it immediately.
I never recommend more than 10% of portfolio in speculative positions.
```

No code changes needed — the agent adapts on the next request.

## Phase 1 MVP

Core portfolio intelligence:

1. Platform position scraping (Robinhood, Coinbase, IBKR)
2. Keelson + OpenBB enrichment
3. Multi-channel alerts (Slack, Telegram, Web)
4. MCP server for Claude Desktop
5. Persona-driven reasoning
6. Morning digest + intraday alerts
7. Web UI dashboard (React + GraphQL)

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

MIT — see [LICENSE](LICENSE) for details.
