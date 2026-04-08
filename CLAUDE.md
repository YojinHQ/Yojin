# Yojin — Personal AI Finance Agent

Personal Bloomberg for retail investors. Multi-agent AI system that ingests portfolio data from investment platforms, enriches positions via Jintel API, and delivers personalized portfolio intelligence through signal curation, insight reports, and trading skill evaluation.

## Architecture

Multi-agent, file-driven architecture. Four specialized agents (Research Analyst, Strategist, Risk Manager, Trader) collaborate through shared state. No database — all state is append-only JSONL files and JSON configs in `~/.yojin/` (or `$YOJIN_HOME`).

### Key Modules

- **`src/core/`** — Agent loop engine: thought→action→observation cycle, ToolRegistry, token budgeting, context compaction, event logging
- **`src/agents/`** — Agent profiles (analyst, strategist, risk-manager, trader), orchestrator for multi-step workflows, agent registry
- **`src/brain/`** — Strategist's persistent cognitive state: BrainStore (versioned commits), EmotionTracker, FrontalLobe (working memory), PersonaManager
- **`src/signals/`** — First-class signal data model (NEWS, FUNDAMENTAL, SENTIMENT, TECHNICAL, MACRO, FILINGS, SOCIALS, TRADING_LOGIC_TRIGGER), archive and group-archive with time-windowed retrieval
- **`src/insights/`** — Structured InsightReport (per-position + portfolio-level synthesis) produced by ProcessInsights workflow, append-only JSONL
- **`src/actions/`** — Action data model (PENDING → APPROVED | REJECTED | EXPIRED), date-partitioned JSONL
- **`src/skills/`** — Markdown-defined trading strategies with trigger conditions (PRICE_MOVE, INDICATOR_THRESHOLD, DRAWDOWN, etc.), SkillEvaluator
- **`src/snap/`** — Snap briefs: short periodic summaries of what deserves attention now
- **`src/memory/`** — Per-role signal memory (analyst, strategist, risk-manager) with ReflectionEngine grading past decisions against outcomes
- **`src/profiles/`** — TickerProfileStore: per-asset persistent knowledge (patterns, lessons, correlations, sentiment), BM25-indexed
- **`src/portfolio/`** — PortfolioSnapshotStore: append-only JSONL for positions, totals, platform metadata
- **`src/watchlist/`** — WatchlistEntry tracking with Jintel-backed enrichment cache
- **`src/jintel/`** — Wrapper around `@yojinhq/jintel-client`: entity fetching, signal fetching, price provider, enrichment
- **`src/data-sources/`** — Pluggable data-feed framework: CLI tools, MCP servers, REST APIs under uniform DataQuery/DataResult interface
- **`src/ai-providers/`** — Multi-provider LLM abstraction: ProviderRouter routes to ClaudeCodeProvider or CodexProvider (Codex CLI subprocess)
- **`src/scraper/`** — Playwright browser automation for investment platforms (IB, Robinhood, Coinbase, Schwab, Binance, Fidelity, PolyMarket, Phantom, custom)
- **`src/guards/`** — Deterministic guard pipeline (25+ guards): security guards (fs, command, egress, output-dlp, rate-budget, repetition) + finance guards (read-only, cooldown, whitelist) + operational postures
- **`src/trust/`** — Trust stack: encrypted vault (PBKDF2 + AES-256-GCM), PII redactor, approval gate, GuardedToolRegistry, security audit log
- **`src/security/`** — AllowlistEntry, SecurityPolicy, SecurityAdapter for custom security implementations
- **`src/identity/`** — Auto-generated per-installation Ed25519 device keypair (no login, device IS the identity)
- **`src/acp/`** — Agent Control Protocol bridge: Claude Code and other frontends orchestrate Yojin workflows via stdio
- **`src/hooks/`** — Lifecycle event system: message ingress/egress, provider before/after completion, channel connect/disconnect
- **`src/api/graphql/`** — GraphQL API (graphql-yoga on Hono): resolvers for portfolio, signals, insights, connections, watchlist, actions, skills, snap, data-sources, vault, chat, onboarding
- **`src/plugins/`** — Plugin system: ProviderPlugin + ChannelPlugin interfaces, registry
- **`src/plugin-sdk/`** — Plugin SDK for external plugin development
- **`src/tools/`** — Agent tools: api-health, brain-tools, portfolio-tools, portfolio-reasoning, data-source-query, display-tools, error-analysis, security-audit
- **`src/auth/`** — Claude OAuth PKCE flow, token management, magic-link, Codex credentials, keychain
- **`src/config/`** — Zod-validated config loader with env var resolution
- **`src/sessions/`** — Session management: per-user/channel conversation state, memory-based and JSONL-backed stores
- **`src/gateway/`** — HTTP server hosting GraphQL API and WebSocket subscriptions
- **`src/cli/`** — CLI commands: start, chat, setup-token, web, secret, bootstrap
- **`src/logging/`** — Structured logging with token/secret redaction, subsystem-specific loggers
- **`providers/`** — LLM provider plugins (`anthropic/`)
- **`channels/`** — Channel plugins (`slack/`, `web/`)
- **`apps/web/`** — React 19 web app: Vite 6, Tailwind CSS 4, React Router 7, urql GraphQL client, Recharts, lightweight-charts

### Root-Level Files

- **`src/composition.ts`** — Composition root: builds full dependency graph (guards, vault, brain, tools, agents, stores), returns YojinServices
- **`src/entry.ts`** — Application entrypoint: logger init, error handlers, dispatches to runMain
- **`src/paths.ts`** — Path resolution single source of truth: `$YOJIN_HOME` / `~/.yojin/`, vault dir, factory defaults
- **`src/scheduler.ts`** — Lightweight job scheduler: curation every 15min, process-insights on daily cron

### Data Directory

```text
~/.yojin/                    # $YOJIN_HOME, runtime data root
├── config/                  # yojin.json, alerts.json, ai-provider.json
├── brain/                   # Strategist cognitive state
├── sessions/                # JSONL conversation histories
├── snapshots/               # Portfolio snapshot history
├── signals/                 # Signal archive (JSONL, date-partitioned)
├── insights/                # InsightReport archive (JSONL)
├── actions/                 # Action archive (JSONL, date-partitioned)
├── memory/                  # Per-role signal memory (JSONL)
├── profiles/                # Per-ticker knowledge profiles
├── skills/                  # Trading strategy definitions (Markdown)
├── snap/                    # Snap briefs
├── watchlist/               # Watchlist entries
├── identity/                # Ed25519 device keypair (mode 0o600)
├── audit/                   # Security audit log (append-only, never truncated)
├── event-log/               # events.jsonl
├── cron/                    # Scheduler job state
├── acp/                     # ACP session mappings
├── cache/                   # Browser sessions, enrichment cache
├── data/                    # Data source outputs and imports
└── logs/                    # Application logs

~/.yojin-vault/              # $YOJIN_VAULT_DIR, encrypted credentials (separate from app data)
└── secrets.json

data/default/                # Factory defaults (git-tracked, bundled with package)
├── persona.default.md
├── connections.default.json
├── data-sources.default.json
├── agents/                  # Per-agent default configs
└── skills/                  # Default trading strategy definitions
```

## Commands

```bash
pnpm dev              # Start backend + web app in parallel (concurrently)
pnpm dev:be           # Start backend only with tsx
pnpm dev:fe           # Start React web app (Vite dev server)
pnpm build            # Compile TypeScript (backend)
pnpm start            # Run compiled output
pnpm test             # Run tests (vitest)
pnpm test:ci          # Run tests in CI mode
pnpm typecheck        # TypeScript type checking (tsc --noEmit)
pnpm lint             # ESLint (src/, providers/, channels/, test/)
pnpm lint:fix         # ESLint with auto-fix
pnpm format           # Prettier format all files
pnpm format:check     # Prettier check formatting
pnpm ci               # Full CI check: format + typecheck + lint + test
pnpm chat             # Interactive chat REPL
pnpm setup            # First-time setup wizard
pnpm yojin:acp        # Run in ACP mode (Agent Control Protocol)
pnpm storybook        # Start Storybook for web components
pnpm build:web        # Build React web app
pnpm build:all        # Build all workspace packages
pnpm test:all         # Run tests across all packages
pnpm ci:all           # Full CI check across all packages
```

## Tech Stack

- **Runtime**: Node.js >= 22.12, ESM (`"type": "module"`)
- **Language**: TypeScript 5.9, strict mode, NodeNext module resolution
- **Package manager**: pnpm 10 (workspaces: `apps/*`, `packages/*`)
- **Testing**: vitest 4
- **Validation**: Zod schemas everywhere
- **Logging**: tslog
- **AI providers**: Anthropic SDK (`@anthropic-ai/sdk`), Codex CLI (via subprocess)
- **Data enrichment**: `@yojinhq/jintel-client` (typed GraphQL client for Jintel API)
- **Web UI**: React 19, Vite 6, Tailwind CSS 4, React Router 7, Recharts, lightweight-charts, lucide-react
- **GraphQL**: graphql-yoga on Hono (server), urql + graphcache (client), graphql-sse (subscriptions)
- **Scraping**: Playwright
- **Channels**: @slack/bolt (Slack), Hono (Web/SSE)
- **ACP**: @agentclientprotocol/sdk (stdio bridge for external agent frontends)
- **State management**: rehydra (lightweight state container)

## Key Types

- `AgentProfile` — Agent definition: system prompt, tool set, allowed actions, provider/model override
- `ProviderPlugin` — LLM provider interface (complete, stream, models)
- `ChannelPlugin` — Messaging channel interface (messaging, auth, setup adapters)
- `Guard` — Deterministic guard check: `check(action) → { pass } | { pass: false, reason }`
- `SecretVault` — Encrypted credential vault (PBKDF2 + AES-256-GCM), never in prompts
- `PiiRedactor` — Strips identifying info before external calls
- `ApprovalGate` — Human-in-the-loop for irreversible actions
- `AuditLog` — Immutable append-only security event log
- `Signal` — First-class data point: type, tickers, sources, confidence, link type (DIRECT/INDIRECT/MACRO)
- `InsightReport` — Per-position insights (thesis, rating, risks, opportunities, price target) + portfolio synthesis
- `Action` — Actionable recommendation with lifecycle (PENDING → APPROVED/REJECTED/EXPIRED)
- `TickerProfile` — Per-asset persistent knowledge: patterns, lessons, correlations, sentiment history
- `DataSource` — Pluggable data feed: CLI tool, MCP server, or REST API with uniform query interface
- `YojinServices` — Composition root output that wires everything together

## Naming Conventions

| Convention               | Example                      | Usage                                               |
|--------------------------|------------------------------|-----------------------------------------------------|
| **camelCase**            | `userName`, `getUserData`    | Functions, methods, variables, properties           |
| **PascalCase**           | `UserName`, `GetUserData`    | Classes, React components, interfaces, type aliases |
| **snake_case**           | `user_name`, `get_user_data` | Database columns, Python interop                    |
| **SCREAMING_SNAKE_CASE** | `USER_NAME`, `MAX_RETRIES`   | True constants                                      |
| **kebab-case**           | `user-name`, `get-user-data` | File names, URLs, CSS classes                       |

## Frontend Design

Always use the `/frontend-design` skill when building or modifying frontend UI components, pages, or views. This ensures high design quality and avoids generic AI aesthetics.
