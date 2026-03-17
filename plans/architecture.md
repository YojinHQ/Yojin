# Yojin — Personal Bloomberg for Retail

## Context

Building the product described in the VC memo: a local AI agent that scrapes investment platforms via Playwright, enriches positions via Keelson API, and delivers personalized portfolio intelligence. The agent is free; Keelson API usage is monetized.

---

## Architecture Decision

Multi-agent architecture with four specialized agents collaborating through shared state. File-driven — all state stored as JSONL files and JSON configs in `data/`. No database, no containers — runs entirely on the user's laptop.

### The Four Agents

| Agent | Role | Tools | Decides |
|-------|------|-------|---------|
| **Research Analyst** | Market intelligence | OpenBB SDK, equity research, news, analysis kit, Keelson enrichment | "What's happening in the market that affects your portfolio?" |
| **Strategist** | Reasoning & recommendations | Brain (persona, memory), research results, risk reports | "Based on your persona and the data, what should you do?" |
| **Risk Manager** | Portfolio risk analysis | Exposure analyzer, concentration, correlation, earnings calendar, drawdown | "What are the risks in your current portfolio?" |
| **Trader** | Execution & platform interaction | Scraper (Playwright), platform login, position tracking, guard pipeline | "Execute the approved action safely on the right platform" |

### How They Collaborate

```
User connects platforms → Trader scrapes positions
                              ↓
                    PortfolioSnapshot → shared state
                              ↓
              ┌───────────────┼───────────────┐
              ↓                               ↓
     Research Analyst                   Risk Manager
     (enriches positions                (analyzes exposure,
      via Keelson + OpenBB)              concentration, correlation)
              ↓                               ↓
     EnrichedSnapshot                    RiskReport
              └───────────────┬───────────────┘
                              ↓
                         Strategist
                    (reads persona, brain memory,
                     enriched data + risk report)
                              ↓
                    Recommendation / Alert
                              ↓
                    [GUARD PIPELINE] → safety check
                              ↓
                    ChannelRouter → all channels
```

Each agent has its own:
- **Tool set** — subset of ToolRegistry relevant to its role
- **System prompt** — specialized persona for its domain
- **Session history** — independent JSONL conversation thread
- **Allowed actions** — scoped by the guard pipeline

Agents are not separate processes — they're specialized profiles within AgentRuntime. Same ProviderRouter, different configurations. The orchestrator triggers them in sequence or parallel depending on the workflow.

### Orchestration Patterns

**Scheduled digest** (morning, heartbeat):
```
Trader.scrape() → Research.enrich() → Risk.analyze()
  → Strategist.digest(enriched, riskReport) → channels
```

**User asks "analyze NVDA"**:
```
Research.analyze('NVDA') → Risk.checkExposure('NVDA')
  → Strategist.recommend(research, risk) → user
```

**User asks "should I sell?"**:
```
Research.enrich(portfolio) → Risk.fullReport()
  → Strategist.reason(research, risk, persona) → user
```

**Trade execution** (Phase 2):
```
Strategist.recommend('sell 50 NVDA') → user approves
  → Guard.check(action) → Trader.execute(action) → confirm via channels
```

---

## Current Codebase (~1,700 lines working TypeScript)

| Module | Status | Description |
|--------|--------|-------------|
| `src/plugins/` (types, registry, SDK) | **Complete** | Plugin system — ProviderPlugin + ChannelPlugin interfaces, registry, lifecycle hooks, public SDK |
| `src/gateway/server.ts` | **Complete** | Message routing: channel → provider → channel. Foundation for AgentRuntime |
| `src/auth/claude-oauth.ts` | **Complete** | Full OAuth PKCE flow (browser + CLI + manual paste) |
| `src/cli/` (run-main, chat, setup-token) | **Complete** | CLI entry points — start server, interactive chat REPL, token setup |
| `src/config/config.ts` | **Complete** | Zod-based config with env var resolution |
| `src/sessions/memory-store.ts` | **Complete** | In-memory session store (SessionStore interface) |
| `providers/anthropic/` | **Complete** | Claude provider — API key + OAuth modes, streaming, model resolution |
| `channels/slack/` | **Complete** | Slack channel via @slack/bolt — messaging, threading, reactions |

---

## Monorepo Structure

```
yojin/
├── package.json                    # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.json
├── vitest.config.ts
├── yojin.mjs                      # CLI entry point (EXISTS)
│
├── providers/                     # LLM Provider Plugins (EXISTS — extensible)
│   └── anthropic/                 # EXISTS — Claude API key + OAuth
│       ├── index.ts
│       └── src/provider.ts
│   # Future: openai/, google/, ollama/
│
├── channels/                      # Channel Plugins (EXISTS — extensible)
│   ├── slack/                     # EXISTS — @slack/bolt
│   │   ├── index.ts
│   │   └── src/channel.ts
│   ├── telegram/                  # TO BUILD — grammY bot
│   │   ├── index.ts
│   │   └── src/channel.ts
│   ├── discord/                   # FUTURE
│   └── web/                       # TO BUILD — Hono + SSE
│       ├── index.ts
│       └── src/channel.ts
│
├── data/                          # Runtime data (gitignored)
│   ├── config/                    # yojin.json, alerts.json, openbb.json, ai-provider.json
│   ├── default/                   # Factory defaults (git-tracked)
│   │   ├── persona.default.md    # Default strategist persona
│   │   └── agents/               # Default agent configs
│   │       ├── research-analyst.default.md
│   │       ├── strategist.default.md
│   │       ├── risk-manager.default.md
│   │       └── trader.default.md
│   ├── brain/                     # Strategist cognitive state
│   │   ├── persona.md            # User's strategist persona (gitignored)
│   │   └── frontal-lobe.md       # Working memory
│   ├── sessions/                  # JSONL conversation histories
│   ├── cache/                     # Keelson responses, browser sessions
│   ├── snapshots/                 # Portfolio snapshot history
│   ├── event-log/                 # events.jsonl
│   ├── news-archive/            # Persistent news archive (JSONL)
│   ├── audit/                     # Security audit log (security.jsonl — append-only)
│   └── cron/                      # Job state
│
├── packages/
│   └── keelson-client/            # Typed GraphQL client for Keelson API
│       └── src/
│           ├── client.ts
│           ├── types.ts
│           └── cache.ts
│
├── src/
│   ├── main.ts                    # Composition root
│   │
│   ├── plugins/                   # EXISTS — Plugin System
│   │   ├── types.ts               # ProviderPlugin, ChannelPlugin interfaces
│   │   ├── registry.ts            # PluginRegistry (provider + channel maps)
│   │   └── plugin-sdk/index.ts    # Public SDK for plugin authors
│   │
│   ├── core/                      # Agent Runtime (EVOLVE from gateway/)
│   │   ├── agent-runtime.ts        # AI orchestration — evolves from gateway/server.ts
│   │   ├── ai-provider-manager.ts # ProviderRouter (multi-provider, hot-reload per request)
│   │   ├── tool-registry.ts         # Unified tool registry (NEW)
│   │   ├── session.ts             # JSONL session store (EVOLVE from sessions/memory-store.ts)
│   │   ├── compaction.ts          # Context window management
│   │   ├── event-log.ts           # Append-only JSONL + ring buffer
│   │   ├── channel-router.ts    # Push delivery routing to channels
│   │   ├── config.ts              # Zod schemas (EVOLVE from config/config.ts)
│   │   └── types.ts               # YojinContext interface
│   │
│   ├── auth/                      # EXISTS — OAuth
│   │   └── claude-oauth.ts        # Full PKCE flow (complete + tested)
│   │
│   ├── cli/                       # EXISTS — CLI
│   │   ├── run-main.ts            # Command dispatcher
│   │   ├── chat.ts                # Interactive REPL
│   │   └── setup-token.ts         # OAuth token acquisition
│   │
│   ├── ai-providers/              # Multi-Provider AI Backend
│   │   ├── types.ts               # AIProvider interface, StreamableResult
│   │   ├── vercel-ai-sdk/         # In-process ToolLoopAgent (Anthropic, OpenAI, Google)
│   │   ├── claude-code/           # Subprocess claude -p (zero-config)
│   │   └── agent-sdk/             # @anthropic-ai/claude-agent-sdk
│   │
│   ├── agents/                    # Multi-Agent Definitions
│   │   ├── types.ts               # AgentProfile, AgentOrchestrator interfaces
│   │   ├── orchestrator.ts        # Coordinates agents in workflows (digest, analyze, trade)
│   │   ├── profiles/              # Agent configurations
│   │   │   ├── research-analyst.ts  # Tools: OpenBB, equity research, news, Keelson, technicals
│   │   │   ├── strategist.ts        # Tools: brain, risk-report, research results
│   │   │   ├── risk-manager.ts      # Tools: exposure, concentration, correlation, earnings
│   │   │   └── trader.ts            # Tools: scraper, platform login, position tracking
│   │   └── registry.ts           # Agent registry + tool-set scoping
│   │
│   ├── brain/                     # Strategist's Persistent Cognitive State
│   │   ├── brain.ts               # Git-like commits for cognitive state
│   │   ├── frontal-lobe.ts        # Working memory — hypotheses, observations
│   │   ├── emotion.ts             # Confidence level, risk appetite
│   │   └── persona.ts             # Persona loader (default/override pattern)
│   │
│   ├── openbb/                    # Research Analyst Data Layer
│   │   ├── sdk/                   # TypeScript-native OpenBB SDK (in-process)
│   │   │   ├── equity/            # Financial statements, ratios, estimates
│   │   │   ├── crypto/            # Digital asset market data
│   │   │   ├── currency/          # Forex data
│   │   │   ├── commodity/         # EIA data, spot prices
│   │   │   ├── economy/           # Macro indicators (FRED, etc.)
│   │   │   └── news/              # Article aggregation API
│   │   ├── symbol-index/          # SEC/TMX local symbol cache
│   │   ├── credential-map.ts      # Config key → OpenBB credential mapping
│   │   └── api-server.ts          # Optional HTTP server (port 6901)
│   │
│   ├── research/                  # Equity Research + Analysis Tools
│   │   ├── equity/                # Company research tools
│   │   │   ├── profile.ts         # equityGetProfile
│   │   │   ├── financials.ts      # equityGetFinancials
│   │   │   ├── ratios.ts          # equityGetRatios
│   │   │   ├── estimates.ts       # equityGetEstimates
│   │   │   ├── earnings.ts        # equityGetEarningsCalendar
│   │   │   ├── insider.ts         # equityGetInsiderTrading
│   │   │   ├── institutional.ts   # equityGetInstitutional
│   │   │   └── movers.ts          # equityGetMovers
│   │   ├── market/search.ts       # Cross-asset symbol search
│   │   ├── technicals/          # Technical indicators (SMA, RSI, BBANDS, MACD, etc.)
│   │   ├── reasoning-tools/          # Reasoning + calculation tools
│   │   └── adapter.ts             # Registers all research tools with ToolRegistry
│   │
│   ├── news/                      # Two-Layer News System
│   │   ├── collector/             # Layer 1: Background RSS aggregation
│   │   │   ├── news-archive.ts
│   │   │   ├── ingester.ts        # Dedup + JSONL archive
│   │   │   └── piggyback.ts       # Captures OpenBB API results on-the-fly
│   │   ├── tools/                 # globNews, grepNews, readNews
│   │   └── api-tools.ts           # Layer 2: Real-time news via OpenBB API
│   │
│   ├── scraper/                   # Browser-as-API
│   │   ├── types.ts               # IPortfolioScraper, PortfolioSnapshot
│   │   ├── scraper-manager.ts     # Multi-platform orchestration
│   │   ├── session-store.ts       # Cookie/localStorage persistence
│   │   ├── pw-helpers.ts          # Playwright utilities
│   │   └── platforms/
│   │       ├── polymarket.ts      # Phase 1
│   │       ├── robinhood.ts       # Phase 2
│   │       ├── coinbase.ts        # Phase 2
│   │       ├── phantom.ts         # Phase 2
│   │       └── ibkr.ts            # Phase 2
│   │
│   ├── enrichment/                # Intelligence layer
│   │   ├── types.ts               # EnrichedPosition, EnrichedSnapshot
│   │   ├── enrichment-pipeline.ts # Scrape -> redact -> enrich -> score
│   │   ├── keelson-enricher.ts    # Keelson GraphQL (sentiment, social, macro)
│   │   ├── openbb-enricher.ts     # OpenBB SDK (fundamentals, price, technicals)
│   │   └── position-analyzer.ts   # Portfolio metrics (concentration, risk, exposure)
│   │
│   ├── trust/                     # 4-Layer Trust Stack (Core Differentiator)
│   │   ├── secretctl/             # Layer 1: Credential Vault
│   │   │   ├── vault.ts           # Encrypted storage (AES-256-GCM)
│   │   │   ├── mcp-server.ts      # MCP server for AI-safe credential access
│   │   │   ├── cli.ts             # CLI: yojin secret set/get/list/delete
│   │   │   └── types.ts           # SecretRef, VaultConfig
│   │   ├── pii/                   # Layer 3: PII Redactor
│   │   │   ├── redactor.ts        # Core redaction engine (regex + pattern matching)
│   │   │   ├── patterns.ts        # Redaction patterns (account IDs, emails, balances)
│   │   │   └── types.ts           # RedactedSnapshot, RedactionRule
│   │   ├── approval/              # Layer 4: Human-in-the-Loop Approval Gate
│   │   │   ├── approval-gate.ts   # Core approval flow
│   │   │   ├── request.ts         # ApprovalRequest type, channel routing
│   │   │   └── config.ts          # Which actions require approval
│   │   └── audit/                 # Security Audit Log
│   │       ├── audit-log.ts       # Immutable append-only JSONL writer
│   │       └── types.ts           # AuditEvent types
│   │
│   ├── guards/                    # Layer 2: RADIUS — Deterministic Guard Pipeline
│   │   ├── types.ts               # Guard interface, GuardResult, ProposedAction
│   │   ├── guard-runner.ts        # Pipeline executor (blocks on first failure)
│   │   ├── posture.ts             # Operational postures (Local/Standard/Unbounded)
│   │   ├── security/              # Infrastructure protection
│   │   │   ├── fs-guard.ts        # Block access to sensitive paths (~/.ssh, ~/.aws)
│   │   │   ├── command-guard.ts   # Regex-match dangerous shell operations
│   │   │   ├── egress-guard.ts    # Network allowlist (domain/IP/port)
│   │   │   ├── output-dlp.ts      # Detect secrets in agent outputs
│   │   │   ├── rate-budget.ts     # Cap tool calls per time window
│   │   │   └── repetition-guard.ts # Block identical repeated tool calls
│   │   ├── finance/               # Domain-specific
│   │   │   ├── read-only.ts       # Block writes in read-only mode
│   │   │   ├── cooldown.ts        # Min time between same-type actions
│   │   │   └── symbol-whitelist.ts # Only approved instruments
│   │   └── registry.ts            # Guard registration + config
│   │
│   ├── risk/                      # Risk Manager — Finance Layer
│   │   ├── types.ts               # ExposureReport, ConcentrationScore, CorrelationCluster
│   │   ├── exposure-analyzer.ts   # Sector/asset-class exposure breakdown
│   │   ├── concentration.ts       # Single-position and sector concentration scoring
│   │   ├── correlation.ts         # Detect correlated position clusters
│   │   ├── earnings-calendar.ts   # Overlay earnings dates on held positions
│   │   ├── drawdown-tracker.ts    # Track daily/weekly P&L drawdown
│   │   └── risk-report.ts         # Compose full portfolio risk report
│   │
│   ├── alerts/                    # Alert engine
│   │   ├── alert-engine.ts        # Rule evaluation on enriched snapshots
│   │   ├── digest-builder.ts      # Morning digest assembly
│   │   └── rules/
│   │       ├── price-move.ts
│   │       ├── sentiment-shift.ts
│   │       ├── earnings-proximity.ts
│   │       ├── concentration-drift.ts
│   │       └── correlation-warning.ts
│   │
│   ├── task/                      # Scheduling
│   │   ├── cron/engine.ts         # at/every/cron scheduling
│   │   ├── cron/listener.ts       # Event-driven execution
│   │   └── heartbeat/             # Periodic AI health check
│   │
│   ├── api/                       # GraphQL API (serves Web UI)
│   │   └── graphql/
│   │       ├── schema.ts          # Type definitions (SDL)
│   │       ├── resolvers/         # Query, Mutation, Subscription resolvers
│   │       │   ├── portfolio.ts   # portfolio, positions, enrichedSnapshot
│   │       │   ├── market.ts      # quote, news, sectorExposure
│   │       │   ├── risk.ts        # riskReport, concentration, correlations
│   │       │   ├── alerts.ts      # alerts, createAlert, dismissAlert
│   │       │   └── live.ts        # Subscriptions (onAlert, onPortfolioUpdate, onPriceMove)
│   │       └── server.ts          # graphql-yoga on Hono, WebSocket subscriptions
│   │
│   ├── server/
│   │   └── mcp.ts                 # MCP server for Claude Desktop/Cursor
│   │
│   └── tools/                     # Agent tools
│       ├── portfolio-tools.ts     # get_portfolio, get_positions, get_history
│       ├── market-tools.ts        # get_quote, get_sentiment, get_fundamentals
│       ├── alert-tools.ts         # create_alert, list_alerts, dismiss_alert
│       ├── risk-tools.ts          # get_exposure, get_concentration, get_correlations, get_risk_report
│       └── scraper-tools.ts       # login_platform, refresh_positions
│
├── test/                          # EXISTS
│   ├── claude-oauth.test.ts       # OAuth PKCE tests (11 suites)
│   └── oauth-integration.ts       # Integration tests
│
└── ui/                            # Phase 2: Web dashboard
```

---

## Multi-Channel Architecture

Yojin supports multiple channels simultaneously via the existing ChannelPlugin interface. Each channel is an independent plugin in `channels/`:

| Channel | Library | Status | Capabilities |
|---------|---------|--------|-------------|
| **Slack** | @slack/bolt | **EXISTS** | Messages, threads, reactions, files, 40K char limit |
| **Telegram** | grammY | Phase 1 | Messages, photos, approval buttons, chunked delivery |
| **Web UI** | Hono + SSE | Phase 1 | Real-time streaming, portfolio dashboard, chat |
| **Discord** | discord.js | Future | Messages, embeds, threads |
| **MCP** | @modelcontextprotocol/sdk | Phase 1 | Tool exposure for Claude Desktop/Cursor |

All channels share the same ChannelPlugin interface (already defined in `src/plugins/types.ts`):
- `messagingAdapter` — send/receive messages
- `authAdapter` — token validation
- `setupAdapter` — initialization
- `capabilities` — threading, reactions, files, etc.

ChannelRouter routes alerts and digests to all active channels. User's last-interacted channel gets priority for interactive responses.

---

## Agent Runtime

### AgentRuntime — The Orchestrator

Evolves from the existing `gateway/server.ts`. Every interaction flows through AgentRuntime: user messages, heartbeat triggers, cron jobs. It owns provider selection, session management, agent routing, and workflow coordination. The orchestrator decides which agents to invoke and in what order.

### ProviderRouter — Multi-Provider AI Backend

Builds on existing `providers/anthropic/` plugin. All four agents share the same ProviderRouter. Three backends, switchable mid-session by editing `ai-provider.json`:

| Provider | Implementation | Use Case |
|----------|---------------|----------|
| Claude Code CLI | Spawns `claude -p` subprocess | Default — zero-config, uses existing auth |
| Vercel AI SDK | In-process `ToolLoopAgent` | Supports Anthropic, OpenAI, Google models |
| Agent SDK | `@anthropic-ai/claude-agent-sdk` | Advanced agent capabilities |

The existing Anthropic provider already handles both API key and OAuth/subprocess modes. ProviderRouter reads config on *each call* — hot-reload without restart.

### Agent Profiles

Each agent is defined as a profile — a system prompt + tool set + config. Profiles live in `src/agents/profiles/` and have user-overridable Markdown definitions in `data/default/agents/`.

```typescript
interface AgentProfile {
  id: 'research-analyst' | 'strategist' | 'risk-manager' | 'trader'
  systemPrompt: string           // loaded from Markdown file
  tools: string[]                // subset of ToolRegistry tools this agent can use
  allowedActions: string[]       // scoped by guard pipeline
  provider?: string              // optional per-agent provider override
  model?: string                 // optional per-agent model override
}
```

---

## Strategist Agent

The Strategist is the decision-maker. It reads the Research Analyst's enriched data, the Risk Manager's reports, and the user's persona to produce recommendations and alerts.

### Natural Language Strategy — Persona as Markdown

Instead of coded strategy classes, strategy is defined in Markdown:

```markdown
# Persona: Conservative Portfolio Analyst

I monitor a diversified portfolio across stocks, crypto, and prediction markets.
I focus on risk-adjusted returns and concentration risk.
When any single position exceeds 25% of portfolio, I flag it immediately.
I watch for earnings catalysts, insider selling, and sentiment shifts.
I never recommend more than 10% of portfolio in prediction markets.
When VIX is above 30, I recommend reducing equity exposure.
```

This lives at `data/brain/persona.md`. The agent reads it and interprets the intent — figuring out which tools to call, how to evaluate the data, and when to alert.

### Default/Override Pattern

```
Factory default:  data/default/persona.default.md   (git-tracked)
User override:    data/brain/persona.md              (gitignored)

First run → default auto-copies to override
Agent reads → override (user's version)
git pull → updates default; override untouched
```

### Brain — Strategist's Persistent Cognitive State

| Component | Purpose |
|-----------|---------|
| Frontal lobe | Working context — current hypotheses, observations, active reasoning |
| Emotion tracking | Agent confidence level, risk appetite, with rationale for each shift |
| Commit history | Git-like versioned snapshots of cognitive state at decision points |

Enables rollback (undo bad reasoning), audit (why did the agent think X at time T?), and continuity (resume coherently after restart). The Brain belongs to the Strategist — the other agents are stateless workers that produce reports on demand.

---

## Research Analyst Agent

The Research Analyst is the data gatherer. It has access to the same financial data a human analyst uses — fundamentals, price data, technicals, news, sentiment. It enriches raw portfolio positions into actionable intelligence that the Strategist and Risk Manager consume.

### OpenBB Data Layer (TypeScript-native, in-process)

TypeScript-native re-implementation of the OpenBB data platform. No Python sidecar — entire stack runs in one Node.js process.

**Asset class SDKs:**

| SDK | Data | Source |
|-----|------|--------|
| `equity/` | Financial statements, ratios, estimates, insider, institutional | yfinance, SEC EDGAR |
| `crypto/` | Digital asset OHLCV, market data | yfinance, CCXT |
| `currency/` | Forex rates and pairs | yfinance |
| `commodity/` | EIA data, spot prices | EIA API |
| `economy/` | Macroeconomic indicators | FRED |
| `news/` | Article aggregation | Benzinga, others |

**SymbolIndex** — local cache for SEC (~13K US equities) and TMX symbols. Zero-latency resolution.

### Equity Research Tools

Auto-registered with ToolRegistry — agent calls autonomously during reasoning:

| Tool | Data |
|------|------|
| `equityGetProfile` | Business description, sector, employees, market cap |
| `equityGetFinancials` | Income statement, balance sheet, cash flow (historical) |
| `equityGetRatios` | Profitability, liquidity, solvency, efficiency metrics |
| `equityGetEstimates` | Revenue/EPS forecasts, price targets, consensus |
| `equityGetEarningsCalendar` | Upcoming earnings dates for held positions |
| `equityGetInsiderTrading` | Recent insider buys/sells, Section 16 filings |
| `equityGetInstitutional` | 13F filings, top holders, position changes |
| `equityGetMovers` | Top gainers, losers, most active |

### Analysis Kit

Formula-based technical indicators:

```
SMA(CLOSE('AAPL', '1d'), 50)
RSI(CLOSE('AAPL', '1d'), 14)
BBANDS(CLOSE('ETH-USD', '1d'), 20, 2)
```

Supported: SMA, EMA, RSI, BBANDS, MACD, ATR, STDEV, MAX, MIN, SUM, AVERAGE. Works across equity, crypto, currency.

### Two-Layer News System

**Layer 1: RSS Aggregation (background)** — continuous feed fetcher, dedup via content hash, JSONL archive, agent tools: `globNews`, `grepNews`, `readNews`

**Layer 2: OpenBB News API (real-time)** — `newsGetCompany`, `newsGetWorld` + piggyback ingestion to archive

---

## Trust & Security Layer (Yojin's Core Differentiator)

Most AI trading agents give the LLM unrestricted access to credentials, filesystems, and APIs. Yojin's thesis: **the more control you give the agent, the more it can help you — and the more it can hurt you.** The trust layer solves the "hurt" side with deterministic, non-bypassable enforcement.

### The 4-Layer Trust Stack

```
Layer 1: secretctl        — Credentials never touch the LLM
Layer 2: RADIUS Guards    — Agent can't act outside boundaries
Layer 3: PII Redactor     — Your identity never leaves your laptop
Layer 4: Approval Gate    — You confirm before anything irreversible
```

Every layer runs **before** the agent acts. A regex match on `rm -rf` is true or false. The agent can't talk its way past it.

### Layer 1: secretctl — Credential Vault

Encrypted local credential vault with MCP-native access. The agent can USE credentials without SEEING them.

- Single encrypted SQLite database stored locally — no cloud, no network
- MCP server integration — AI tools query secrets via protocol, never raw values
- CLI for management: `yojin secret set ANTHROPIC_API_KEY`, `yojin secret list`
- Credentials injected into API calls at the transport layer, never in prompts
- Audit log of every credential access

```
src/trust/secretctl/
├── vault.ts          # Encrypted storage (AES-256-GCM)
├── mcp-server.ts     # MCP server for AI-safe credential access
├── cli.ts            # CLI commands for secret management
└── types.ts          # SecretRef, VaultConfig
```

### Layer 2: RADIUS — Deterministic Pre-Execution Guards

Every agent action passes through a pipeline of deterministic guards. Guards are pure functions — no LLM, no prompt, no interpretation. They either pass or block.

```
Agent Decision → [GUARD PIPELINE] → Execute / Block + Audit
                       │
              ┌────────┴────────┐
              │  Security Guards │ (infrastructure protection)
              │  fs_guard        │ Restrict file access to whitelisted paths
              │  command_guard   │ Block dangerous shell patterns (sudo, rm -rf, pipes)
              │  egress_guard    │ Network allowlist (domain/IP/port)
              │  output_dlp      │ Detect and redact secrets in LLM outputs
              │  rate_budget     │ Cap tool calls per minute (prevent runaway loops)
              │  repetition_guard│ Block identical repeated tool calls
              ├──────────────────┤
              │  Finance Guards  │ (domain-specific)
              │  read_only       │ Block all write/trade actions in read-only mode
              │  cooldown        │ Min time between same-type actions
              │  symbol_whitelist│ Only approved instruments
              └──────────────────┘
```

Guards implement a simple interface:

```typescript
interface Guard {
  name: string
  check(action: ProposedAction): GuardResult
}
type GuardResult = { pass: true } | { pass: false; reason: string }
```

```
src/guards/
├── types.ts              # Guard interface, GuardResult, ProposedAction
├── guard-runner.ts       # Pipeline executor (runs all guards, blocks on first failure)
├── security/             # Infrastructure protection
│   ├── fs-guard.ts       # Block access to ~/.ssh, ~/.aws, /etc, sensitive paths
│   ├── command-guard.ts  # Regex-match dangerous shell operations before execution
│   ├── egress-guard.ts   # Network filtering: domain/IP/port allowlists
│   ├── output-dlp.ts     # Detect AWS keys, tokens, certs in agent outputs
│   ├── rate-budget.ts    # Cap tool calls per time window (prevent runaway)
│   └── repetition-guard.ts # Block identical repeated tool calls
├── finance/              # Domain-specific
│   ├── read-only.ts      # Block writes when RADIUS is in read-only mode
│   ├── cooldown.ts       # Min time between same-type actions on same instrument
│   └── symbol-whitelist.ts # Only approved instruments can be acted on
└── registry.ts           # Guard registration + config
```

### Operational Postures

Three pre-configured profiles that control guard strictness:

| Profile | Use Case | Default Policy | Rate Limit |
|---------|----------|---------------|------------|
| **Local** | Production — real money, real credentials | Default deny; all guards active | 30 calls/min |
| **Standard** | Development — testing with sandbox accounts | Default deny; secrets redacted | 60 calls/min |
| **Unbounded** | Research — no trading, analysis only | Logging only; observe mode | 120 calls/min |

### Layer 3: PII Redactor

Strips identifying information before any data leaves the laptop. Runs automatically on every enrichment call.

| What Gets Redacted | Where It's Applied |
|--------------------|-------------------|
| Account IDs, account names | Before Keelson API calls |
| Exact balances (replaced with ranges) | Before any external API |
| Personal identifiers (email, name) | Before any external API |
| Platform credentials | Never leave secretctl |

OpenBB calls are local/in-process — no redaction needed. Keelson calls always pass through the redactor.

```
src/trust/pii/
├── redactor.ts       # Core redaction engine (regex + pattern matching)
├── patterns.ts       # Redaction patterns (account IDs, emails, balances)
├── types.ts          # RedactedSnapshot, RedactionRule
└── redactor.spec.ts  # Tests — most critical test suite in the project
```

### Layer 4: Approval Gate — Human-in-the-Loop

For irreversible actions, the agent pauses and asks the user for approval via their active channel.

**Actions requiring approval (configurable):**
- Trade execution (buy/sell/close)
- New platform connection (broker login)
- Config changes (guard posture, alert thresholds)
- Any action the Strategist flags as high-risk

**Flow:**
```
Agent proposes action → Guard pipeline passes → Approval gate triggered
  → Send approval request to user's channel (Telegram/Slack/Web)
  → User taps Approve / Deny
  → Approve → execute action → log result
  → Deny → log denial → notify agent → agent adjusts reasoning
  → Timeout (configurable) → auto-deny + log
```

```
src/trust/approval/
├── approval-gate.ts  # Core approval flow
├── request.ts        # ApprovalRequest type, channel routing
└── config.ts         # Which actions require approval
```

### Security Audit Log

Immutable append-only log of all security-relevant events. Separate from the general EventLog — this is tamper-evident.

| Event Type | What's Logged |
|------------|--------------|
| `guard.pass` | Action passed all guards |
| `guard.block` | Action blocked — which guard, why |
| `secret.access` | Credential accessed — which key, by which agent |
| `pii.redact` | PII redacted — field count, before/after hash |
| `approval.request` | Approval requested — action, channel, timestamp |
| `approval.result` | User approved/denied — latency, channel |
| `posture.change` | Guard posture changed |

Stored at `data/audit/security.jsonl` — append-only, never truncated.

---

## Risk Manager Agent (Finance Layer)

The Risk Manager is a specialized agent focused on portfolio-level financial risk analysis. It **analyzes and reports** — it doesn't block actions (that's the Guard Pipeline's job). The Risk Manager feeds intelligence into alerts and the Strategist's reasoning.

### Exposure Analysis

| Analysis | What It Computes |
|----------|-----------------|
| Sector exposure | % of portfolio in tech, energy, healthcare, crypto, prediction markets |
| Concentration scoring | Single-position concentration (e.g., "NVDA is 34% of portfolio") |
| Correlation detection | Clusters of correlated positions (e.g., "NVDA + AMD + MSFT all move together") |
| Earnings calendar | Which held positions have earnings in the next N days |
| Drawdown tracking | Daily/weekly P&L drawdown vs configurable thresholds |

### Risk Report

The Risk Manager composes a full portfolio risk report that:
- The **agent** reads during reasoning (to decide what to alert about)
- The **alert engine** uses for risk-based alert rules (concentration-drift, correlation-warning)
- The **user** queries via natural language: "what's my exposure?" or "do I have correlated positions?"

```typescript
interface RiskReport {
  sectorExposure: Record<string, number>       // sector → % of portfolio
  concentrationScore: number                    // 0-100, higher = more concentrated
  topConcentrations: Array<{ symbol: string; weight: number }>
  correlatedClusters: Array<{ symbols: string[]; correlation: number }>
  earningsProximity: Array<{ symbol: string; daysUntilEarnings: number }>
  drawdown: { daily: number; weekly: number; threshold: number }
}
```

### Per-Asset Configuration

Risk parameters configured differently per asset class in `data/config/`:
- Crypto: higher concentration tolerance (volatile, fewer positions typical)
- Equities: stricter sector limits
- Prediction markets: capped at X% of total portfolio

---

## Enrichment: Dual-Source Architecture

| Source | Data | Cost | Latency |
|--------|------|------|---------|
| **Keelson API** | Social sentiment (Reddit, Twitter), composed signals, prediction market context | Per-query (monetized) | ~200ms |
| **OpenBB SDK** | Fundamentals, price data, technicals, earnings calendar, insider activity | Free (in-process) | ~50ms |

```typescript
async enrich(snapshot: PortfolioSnapshot): Promise<EnrichedSnapshot> {
  const redacted = piiRedactor.redact(snapshot)
  const [keelsonData, openbbData] = await Promise.all([
    keelsonEnricher.enrich(redacted),   // sentiment, social, composed signals
    openbbEnricher.enrich(redacted),    // fundamentals, price, technicals, earnings
  ])
  return positionAnalyzer.merge(redacted, keelsonData, openbbData)
}
```

Keelson handles what OpenBB can't (social sentiment, prediction market context). OpenBB handles free data (price, fundamentals, technicals). Agent burns Keelson credits only for intelligence that requires it.

---

## Data Flow

```
[Polymarket] ──Playwright──→ ScraperManager
[Robinhood]  ──Playwright──→      ↓
[Coinbase]   ──Playwright──→ PortfolioSnapshot (raw)
                                   ↓
                          ┌── TRUST LAYER ──┐
                          │                  │
                          │ PiiRedactor      │ ← Strip account IDs, balances, PII
                          │ .redact()        │    before any external call
                          │                  │
                          └────────┬─────────┘
                                   ↓
                  ┌────────────────┼────────────────┐
                  ↓                                  ↓
          KeelsonEnricher                     OpenBBEnricher
          (sentiment, social,                 (fundamentals, price,
           composed signals)                   technicals, earnings)
          ↑ credentials via                   ↑ local/in-process
            secretctl (never                    no redaction needed
            in prompts)
                  ↓                                  ↓
                  └────────────────┬────────────────┘
                                   ↓
                     PositionAnalyzer.merge()
                                   ↓
                            EnrichedSnapshot
                                   ↓
              ┌────────────────────┼────────────────────┐
              ↓                    ↓                     ↓
       RiskManager           EventLog              ToolRegistry
       .analyze()            .append()             (agent queries)
              ↓
       RiskReport → AlertEngine.evaluate()
              ↓                                         ↓
       AlertEvent[]                        AgentRuntime.ask() ← reads persona.md
              ↓                              ↓ uses Brain for memory
              ↓                         ProviderRouter
              ↓                         (Claude/GPT/Gemini)
              ↓                              ↓
              ↓                    ┌── RADIUS GUARDS ──┐
              ↓                    │ security guards    │ ← fs, command, egress, DLP
              ↓                    │ finance guards     │ ← read-only, cooldown, whitelist
              ↓                    │ audit every check  │ → data/audit/security.jsonl
              ↓                    └── PASS / BLOCK ───┘
              ↓                              ↓
              ↓                    ┌── APPROVAL GATE ──┐
              ↓                    │ irreversible       │ ← trades, config changes
              ↓                    │ actions → user     │    new connections
              ↓                    │ approve/deny       │
              ↓                    └──────────┬────────┘
              ↓                               ↓
       ChannelRouter ←──────── ChannelRouter
              ↓
     [Slack] [Telegram] [Web UI] [Discord] ...
     (all security events → AuditLog)

Autonomous Research Flow:
  Agent reasoning about NVDA position (guided by persona) →
    equityGetFinancials('NVDA')     → income/balance/cashflow
    equityGetEarningsCalendar()     → earnings in 3 days
    equityGetInsiderTrading('NVDA') → CEO sold 50K shares
    grepNews('NVDA')                → 12 articles this week
    calculateIndicator('RSI(CLOSE("NVDA","1d"),14)') → RSI 78 (overbought)
    → Brain commits: "NVDA: high risk — earnings + insider selling + overbought"
    → Alert: "Reduce NVDA exposure"
      → RADIUS guards: PASS (read-only, no trade action)
      → ChannelRouter → all active channels
```

---

## Key Interfaces

```typescript
// Scraper
interface IPortfolioScraper {
  platform: PlatformId
  isAuthenticated(): Promise<boolean>
  login(): Promise<{ success: boolean; error?: string }>
  scrapePositions(): Promise<PortfolioSnapshot>
}

// Enrichment (dual-source)
interface EnrichmentPipeline {
  enrich(snapshot: PortfolioSnapshot): Promise<EnrichedSnapshot>
}

// Alerts
interface AlertEngine {
  evaluate(snapshot: EnrichedSnapshot): Promise<AlertEvent[]>
  addRule(rule: AlertRule): string
  listRules(): AlertRule[]
}

// Guard Pipeline (agent safety — generic, not finance-specific)
interface Guard {
  name: string
  check(action: ProposedAction): GuardResult
}
type GuardResult = { pass: true } | { pass: false; reason: string }

// Risk Manager (finance layer — analyzes, doesn't block)
interface RiskManager {
  analyze(snapshot: EnrichedSnapshot): Promise<RiskReport>
  getSectorExposure(): Promise<Record<string, number>>
  getConcentrationScore(): Promise<number>
  getCorrelatedClusters(): Promise<Array<{ symbols: string[]; correlation: number }>>
  getEarningsProximity(): Promise<Array<{ symbol: string; daysUntilEarnings: number }>>
}

// Trust Stack — secretctl (Layer 1)
interface SecretVault {
  set(key: string, value: string): Promise<void>
  get(key: string): Promise<string>           // only at transport layer, never in prompts
  list(): Promise<string[]>                   // returns key names only, never values
  delete(key: string): Promise<void>
  audit(): Promise<SecretAccessEvent[]>       // who accessed what, when
}

// Trust Stack — PII Redactor (Layer 3)
interface PiiRedactor {
  redact(snapshot: PortfolioSnapshot): RedactedSnapshot
  addPattern(pattern: RedactionRule): void
  getStats(): { fieldsRedacted: number; callsProcessed: number }
}

// Trust Stack — Approval Gate (Layer 4)
interface ApprovalGate {
  requestApproval(action: ProposedAction): Promise<ApprovalResult>
  configure(rules: ApprovalRule[]): void
  getPending(): Promise<ApprovalRequest[]>
}
type ApprovalResult = { approved: true } | { approved: false; reason: string; timedOut: boolean }

// Audit Log
interface AuditLog {
  append(event: AuditEvent): void
  query(filter: AuditFilter): Promise<AuditEvent[]>
}

// Brain (cognitive state)
interface Brain {
  getFrontalLobe(): Promise<string>
  updateFrontalLobe(content: string): Promise<CommitHash>
  getEmotion(): Promise<{ state: string; reason: string }>
  updateEmotion(state: string, reason: string): Promise<CommitHash>
  getLog(): Promise<BrainCommit[]>
}

// Channel Plugin (EXISTS in src/plugins/types.ts)
interface ChannelPlugin {
  id: string
  meta: { name: string; description: string }
  capabilities: ChannelCapabilities
  messagingAdapter: MessagingAdapter
  authAdapter: AuthAdapter
  setupAdapter: SetupAdapter
}

// GraphQL API (thin layer over existing services)
// Served by graphql-yoga on Hono, WebSocket subscriptions
// Resolvers call: scraperManager, enrichmentPipeline, riskManager,
//                 alertEngine, openbbSdk, newsCollector

// Context (wires everything)
interface YojinContext {
  config: YojinConfig
  pluginRegistry: PluginRegistry    // EXISTS
  connectorCenter: ChannelRouter
  agentCenter: AgentRuntime
  eventLog: EventLog
  scraperManager: ScraperManager
  enrichmentPipeline: EnrichmentPipeline
  alertEngine: AlertEngine
  // Trust & Security (core differentiator)
  guardRunner: GuardRunner         // RADIUS guard pipeline
  secretVault: SecretVault         // Encrypted credential vault
  piiRedactor: PiiRedactor         // PII stripping for external calls
  approvalGate: ApprovalGate       // Human-in-the-loop for irreversible actions
  auditLog: AuditLog              // Immutable security event log
  // Finance
  riskManager: RiskManager         // Portfolio risk analysis
  brain: Brain
  openbbSdk: OpenBBSdk
  newsCollector: NewsArchive
}
```

---

## GraphQL API

The Web UI queries all data through a GraphQL API served by `graphql-yoga` on Hono. Subscriptions over WebSocket give the UI real-time updates.

```graphql
type Query {
  portfolio: PortfolioSnapshot
  positions: [Position!]!
  enrichedSnapshot: EnrichedSnapshot
  riskReport: RiskReport
  alerts(status: AlertStatus): [Alert!]!
  news(symbol: String, limit: Int): [Article!]!
  quote(symbol: String!): Quote
  sectorExposure: [SectorWeight!]!
}

type Subscription {
  onAlert: Alert!
  onPortfolioUpdate: PortfolioSnapshot!
  onPriceMove(symbol: String!, threshold: Float!): PriceEvent!
}

type Mutation {
  refreshPositions(platform: Platform!): PortfolioSnapshot!
  createAlert(rule: AlertRuleInput!): Alert!
  dismissAlert(id: ID!): Alert!
}
```

Resolvers are thin — they call into the same services the agents use (enrichment pipeline, risk manager, alert engine, scraper manager). No business logic in the API layer.

---

## Team Ownership

### Dean: Data Pipeline

| Component | Module |
|-----------|--------|
| Scraper Framework | `src/scraper/` |
| OpenBB SDK | `src/openbb/` |
| Research Tools | `src/research/` |
| News System | `src/news/` |
| Keelson Client | `packages/keelson-client/` |
| Enrichment Pipeline | `src/enrichment/` |
| Risk Manager | `src/risk/` |
| Alert Engine | `src/alerts/` |

### Dima: Agent Runtime, Security & API

| Component | Module |
|-----------|--------|
| Core Runtime | `src/core/` (AgentRuntime, ToolRegistry, sessions, events) |
| Trust & Security | `src/trust/` + `src/guards/` (secretctl, RADIUS, PII, approval, audit) |
| Strategist + Brain | `src/brain/` + `src/agents/` |
| Channels | `channels/` (Telegram, Web) |
| GraphQL API | `src/api/graphql/` (schema, resolvers, subscriptions) |
| MCP Server | `src/server/mcp.ts` |
| Agent Tools | `src/tools/` |
| Composition Root | `src/main.ts` |

### Interface Contracts

```
Dean produces → Dima consumes:
  PortfolioSnapshot  (scraper → enrichment pipeline)
  EnrichedSnapshot   (enrichment → Strategist + ToolRegistry + GraphQL)
  RiskReport         (risk manager → Strategist + tools + GraphQL)
  AlertEvent[]       (alert engine → ChannelRouter + GraphQL subscriptions)

Dima provides → Dean calls:
  PiiRedactor        (trust layer → enrichment pipeline)
  SecretVault        (trust layer → scraper credentials)
  ToolRegistry.register() (core → research tools adapter)
```

---

## Phase 1 MVP: Prediction Market Intelligence Only

Per validator recommendation (scored 8/10). Polymarket only, no brokerage integrations.

### Deliverables
1. **Trust & Security Layer** — secretctl vault (encrypted SQLite + MCP), RADIUS guard pipeline (security + finance guards, operational postures), PII redactor, approval gate, security audit log
2. Strategist layer (AgentRuntime + ProviderRouter + Brain + default persona)
3. ToolRegistry — unified tool registry
4. OpenBB data layer (market data SDK — price feeds and macro context)
5. Polymarket scraper (Playwright login + position extraction)
6. Keelson enrichment (sentiment, news for prediction markets)
7. News system (RSS collector + OpenBB news API for market context)
8. Core agent tools (get_portfolio, get_market_details, search_markets, alerts)
9. Multi-channel alerts (Slack exists, add Telegram + Web)
10. GraphQL API (schema, resolvers, subscriptions — serves Web UI)
11. MCP server for Claude Desktop/Cursor
12. Heartbeat (periodic "any markets moving?")

### Phase 2 Expansion
- **2a**: Robinhood + Coinbase scrapers, cross-platform aggregation
- **2b**: Full equity research tools (financials, ratios, estimates, insider, institutional)
- **2c**: Analysis kit (technical indicators — SMA, RSI, MACD, Bollinger Bands)
- **2d**: Risk manager (exposure analysis, concentration scoring, correlation detection, earnings overlay)
- **2e**: Phantom wallet (Solana/DeFi positions)
- **2f**: IBKR (options intelligence)
- **2g**: Web dashboard (React, portfolio visualization)
- **2h**: Advanced intelligence (correlation analysis, position recommendations)
- **2i**: Trade execution (RADIUS write mode, full guard pipeline)
- **2j**: Discord channel plugin

---

## Implementation Order

### Step 1: Core Runtime
1. **ToolRegistry**: Unified tool registry (critical for everything)
2. **AgentRuntime**: Orchestrator with tool loops, persona injection, session-aware calls
3. **Session persistence**: JSONL file-based session store
4. **Event log**: Append-only JSONL + ring buffer
5. **ChannelRouter**: Route alerts/responses to all active channels
6. **Config system**: Zod schemas, hot-reload, openbb.json, guard config

### Step 2: Trust & Security Layer (Core Differentiator)
7. **secretctl**: Encrypted SQLite vault, MCP server for AI-safe credential access, CLI
8. **RADIUS guard pipeline**: Guard runner, operational postures (Local/Standard/Unbounded)
9. **Security guards**: fs-guard, command-guard, egress-guard, output-dlp, rate-budget, repetition-guard
10. **Finance guards**: read-only, cooldown, symbol-whitelist
11. **PII redactor**: Redaction engine, patterns, tests
12. **Approval gate**: Human-in-the-loop flow, channel routing, configurable actions
13. **Security audit log**: Immutable append-only JSONL at data/audit/security.jsonl

### Step 3: Strategist + Brain
14. **Strategist**: Brain (frontal-lobe, emotion, persona), default persona
15. **Agent profiles**: Research analyst, strategist, risk manager, trader definitions
16. **Orchestrator**: Workflow coordination (digest, analyze, trade patterns)

### Step 4: Data Layer
17. **OpenBB SDK**: Market data layer (equity, crypto, currency, commodity, economy, symbol-index)
18. **Research tools**: Equity tools, analysis kit, thinking kit, market search
19. **News system**: RSS collector, archive tools, API news tools

### Step 5: Portfolio & Enrichment
20. **Keelson client**: GraphQL client + cache
21. **Scraper framework**: types, manager, session-store, pw-helpers
22. **Polymarket scraper**: Platform-specific Playwright automation
23. **Enrichment pipeline**: Dual-source (Keelson + OpenBB), position-analyzer

### Step 6: Risk, Alerts & Channels
24. **Risk manager**: Exposure analyzer, concentration scoring, correlation detection, earnings calendar, drawdown tracker
25. **Alert engine**: Rules + digest builder (fed by RiskReport)
26. **Agent tools**: Portfolio, market, alert, risk, scraper tools
27. **Telegram channel**: grammY bot plugin in `channels/telegram/`
28. **Web channel**: Hono + SSE plugin in `channels/web/`

### Step 7: GraphQL API
29. **Schema**: Type definitions for portfolio, risk, alerts, market data
30. **Resolvers**: Query/Mutation resolvers calling into existing services
31. **Subscriptions**: WebSocket-based live updates (alerts, portfolio, price moves)

### Step 8: Wire & Ship
32. **Wire main.ts**: Composition root connecting everything
33. **MCP server**: Register all tools for Claude Desktop

---

## Verification

1. `pnpm install && pnpm build` — compiles cleanly
2. `pnpm test` — unit tests for enrichment pipeline, alert rules, PII redactor, analysis kit, guards
3. **secretctl**: `yojin secret set TEST_KEY` → stored encrypted, `yojin secret list` → shows key names only, audit log records access
4. **RADIUS guards**: attempt `rm -rf /` via agent → command-guard blocks, audit log records block event
5. **PII redactor**: feed snapshot with account IDs → verify IDs stripped before Keelson call, audit log records redaction
6. **Approval gate**: agent proposes trade → approval request sent to Telegram → user denies → action blocked + logged
7. **Security audit**: verify `data/audit/security.jsonl` has entries for guard.pass, guard.block, secret.access, pii.redact
8. **Operational postures**: switch from Local to Unbounded → rate limits change, verify via guard behavior
9. Manual: `npx yojin` → logs in to Polymarket → scrapes positions → enriches via Keelson + OpenBB → sends alert
10. MCP: open Claude Desktop, verify Yojin tools appear and return portfolio data
11. Persona: edit `data/brain/persona.md` → agent behavior adapts without restart
12. Risk: ask "what's my exposure?" → returns sector breakdown, concentration score, correlated positions
13. Multi-channel: same alert delivered to all connected channels
