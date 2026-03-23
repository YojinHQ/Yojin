# Yojin — Personal AI Finance Agent

Personal Bloomberg for retail investors. Multi-agent AI system that scrapes investment platforms, enriches positions via Keelson API + OpenBB SDK, and delivers personalized portfolio intelligence.

## Architecture

Multi-agent, file-driven architecture. Four specialized agents (Research Analyst, Strategist, Risk Manager, Trader) collaborate through shared state. No database — all state is JSONL files and JSON configs in `data/`.

### Key Modules

- **`src/core/`** — Agent runtime: AgentRuntime, ToolRegistry, ProviderRouter, session store, event log, ChannelRouter
- **`src/agents/`** — Multi-agent definitions: orchestrator, profiles (research-analyst, strategist, risk-manager, trader), registry
- **`src/brain/`** — Strategist's persistent cognitive state: persona, frontal-lobe (working memory), emotion tracking
- **`src/openbb/`** — TypeScript-native OpenBB SDK (in-process, no Python): equity, crypto, currency, commodity, economy, news
- **`src/research/`** — Equity research tools, technicals (technical indicators), reasoning tools
- **`src/news/`** — Two-layer news: RSS collector (background) + OpenBB API (real-time)
- **`src/scraper/`** — Playwright browser automation for investment platforms
- **`src/enrichment/`** — Dual-source enrichment pipeline: Keelson (sentiment) + OpenBB (fundamentals)
- **`src/risk/`** — Risk Manager: exposure analysis, concentration scoring, correlation detection, earnings calendar
- **`src/guards/`** — Deterministic guard pipeline: security guards (fs, command, egress, output-dlp, rate-budget, repetition) + finance guards (read-only, cooldown, whitelist) + operational postures
- **`src/trust/`** — Trust stack: encrypted credential vault (AES-256-GCM + MCP), PII redactor, approval gate, security audit log
- **`src/alerts/`** — Alert engine: rule evaluation on enriched snapshots, morning digest builder
- **`src/api/graphql/`** — GraphQL API for Web UI: schema, resolvers, subscriptions (graphql-yoga on Hono)
- **`src/plugins/`** — Plugin system: ProviderPlugin + ChannelPlugin interfaces, registry (complete)
- **`src/tools/`** — Agent tools registered with ToolRegistry
- **`providers/`** — LLM provider plugins (anthropic/ exists)
- **`channels/`** — Channel plugins (slack/ exists, telegram/, web/, discord/)
- **`packages/keelson-client/`** — Typed GraphQL client for Keelson API
- **`apps/web/`** — React 19 web app: Vite 6, Tailwind CSS 4, React Router 7, urql GraphQL client, Recharts
- **`data/`** — Runtime data directory (gitignored except `data/default/`)

### Existing Code (complete, working)

- `src/plugins/` — ProviderPlugin + ChannelPlugin interfaces, PluginRegistry, plugin SDK
- `src/gateway/server.ts` — Message routing (evolves into AgentRuntime)
- `src/auth/claude-oauth.ts` — Full OAuth PKCE flow (tested)
- `src/cli/` — CLI entry points (run-main, chat REPL, setup-token)
- `src/config/config.ts` — Zod config with env var resolution
- `src/sessions/memory-store.ts` — In-memory sessions (evolves to JSONL)
- `src/api/` — GraphQL API (graphql-yoga on Hono), SDL schema, resolvers with mock data, health endpoint
- `apps/web/` — React 19 web app (Vite 6, Tailwind 4, React Router 7, urql), dark-themed dashboard with pages for portfolio, risk, agents, alerts, settings
- `providers/anthropic/` — Claude provider (API key + OAuth subprocess)
- `channels/slack/` — Slack via @slack/bolt

### Data Directory

```text
data/
├── config/          # yojin.json, alerts.json, openbb.json, ai-provider.json
├── default/         # Factory defaults (git-tracked)
│   ├── persona.default.md
│   └── agents/      # Per-agent default configs
├── brain/           # Strategist cognitive state (gitignored)
├── sessions/        # JSONL conversation histories
├── cache/           # Keelson responses, browser sessions
├── snapshots/       # Portfolio snapshot history
├── event-log/       # events.jsonl
├── news-archive/    # Persistent news archive (JSONL)
├── audit/           # Security audit log (security.jsonl — append-only, never truncated)
├── cron/            # Job state
└── acp/             # ACP session mappings (sessions.json)
```

## Commands

```bash
pnpm dev              # Start backend with tsx (development)
pnpm build            # Compile TypeScript (backend)
pnpm start            # Run compiled output
pnpm test             # Run tests (vitest)
pnpm lint             # ESLint
pnpm chat             # Interactive chat REPL
pnpm dev:web          # Start React web app (Vite dev server)
pnpm dev:all          # Start backend + web app in parallel
pnpm build:web        # Build React web app
pnpm build:all        # Build all workspace packages
pnpm test:all         # Run tests across all packages
pnpm ci:all           # Full CI check across all packages
```

## Tech Stack

- **Runtime**: Node.js >= 22.12, ESM (`"type": "module"`)
- **Language**: TypeScript 5.7, strict mode, NodeNext module resolution
- **Package manager**: pnpm 10 (workspaces: `apps/*`, `packages/*`)
- **Testing**: vitest
- **Validation**: Zod schemas everywhere
- **Logging**: tslog
- **AI providers**: Anthropic SDK, Vercel AI SDK, Claude Code CLI subprocess
- **Web UI**: React 19, Vite 6, Tailwind CSS 4, React Router 7
- **GraphQL**: graphql-yoga on Hono, urql (client)
- **Scraping**: Playwright
- **Channels**: @slack/bolt (exists), grammY (Telegram), Hono (Web/SSE)

## Key Types

- `AgentProfile` — Agent definition: system prompt, tool set, allowed actions, provider/model override
- `ProviderPlugin` — LLM provider interface (complete, stream, models)
- `ChannelPlugin` — Messaging channel interface (messaging, auth, setup adapters)
- `Guard` — Deterministic guard check: `check(action) → { pass } | { pass: false, reason }`
- `SecretVault` — Encrypted credential vault (AES-256-GCM), MCP-accessible, never in prompts
- `PiiRedactor` — Strips identifying info before external calls
- `ApprovalGate` — Human-in-the-loop for irreversible actions
- `AuditLog` — Immutable append-only security event log
- `RiskReport` — Portfolio risk analysis output (exposure, concentration, correlation, drawdown)
- `YojinContext` — Composition root that wires everything together

## Naming Conventions

| Convention               | Example                      | Usage                                               |
|--------------------------|------------------------------|-----------------------------------------------------|
| **camelCase**            | `userName`, `getUserData`    | Functions, methods, variables, properties           |
| **PascalCase**           | `UserName`, `GetUserData`    | Classes, React components, interfaces, type aliases |
| **snake_case**           | `user_name`, `get_user_data` | Database columns, Python interop                    |
| **SCREAMING_SNAKE_CASE** | `USER_NAME`, `MAX_RETRIES`   | True constants                                      |
| **kebab-case**           | `user-name`, `get-user-data` | File names, URLs, CSS classes                       |
