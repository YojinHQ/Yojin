---
description: Detailed module reference and data directory structure
globs: ["src/**/*.ts"]
---

# Architecture Reference

## All Modules

- **`src/core/`** — Agent loop engine: thought→action→observation cycle, ToolRegistry, token budgeting, context compaction, event logging
- **`src/agents/`** — Agent profiles (analyst, strategist, risk-manager, trader), orchestrator for multi-step workflows, agent registry
- **`src/brain/`** — Strategist's persistent cognitive state: BrainStore (versioned commits), EmotionTracker, FrontalLobe (working memory), PersonaManager
- **`src/signals/`** — First-class signal data model, archive and group-archive with time-windowed retrieval
- **`src/insights/`** — Structured InsightReport (per-position + portfolio-level synthesis), append-only JSONL
- **`src/actions/`** — Action data model (PENDING → APPROVED | REJECTED | EXPIRED), date-partitioned JSONL
- **`src/strategies/`** — Markdown-defined trading strategies with trigger conditions, StrategyEvaluator
- **`src/snap/`** — Snap briefs: short periodic summaries of what deserves attention now
- **`src/memory/`** — Per-role signal memory with ReflectionEngine grading past decisions against outcomes
- **`src/profiles/`** — TickerProfileStore: per-asset persistent knowledge, BM25-indexed
- **`src/portfolio/`** — PortfolioSnapshotStore: append-only JSONL for positions, totals, platform metadata
- **`src/watchlist/`** — WatchlistEntry tracking with Jintel-backed enrichment cache
- **`src/jintel/`** — Wrapper around `@yojinhq/jintel-client`: entity fetching, signal fetching, price provider
- **`src/data-sources/`** — Pluggable data-feed framework: CLI tools, MCP servers, REST APIs
- **`src/ai-providers/`** — Multi-provider LLM abstraction: ProviderRouter routes to ClaudeCodeProvider or CodexProvider
- **`src/scraper/`** — Playwright browser automation for investment platforms
- **`src/guards/`** — Deterministic guard pipeline (25+ guards): security + finance guards + operational postures
- **`src/trust/`** — Trust stack: encrypted vault, PII redactor, approval gate, GuardedToolRegistry, audit log
- **`src/security/`** — AllowlistEntry, SecurityPolicy, SecurityAdapter
- **`src/identity/`** — Auto-generated per-installation Ed25519 device keypair
- **`src/acp/`** — Agent Control Protocol bridge for external frontends
- **`src/hooks/`** — Lifecycle event system: message ingress/egress, provider before/after completion
- **`src/api/graphql/`** — GraphQL API (graphql-yoga on Hono)
- **`src/plugins/`** — Plugin system: ProviderPlugin + ChannelPlugin interfaces, registry
- **`src/plugin-sdk/`** — Plugin SDK for external plugin development
- **`src/tools/`** — Agent tools: api-health, brain-tools, portfolio-tools, data-source-query, display-tools
- **`src/auth/`** — Claude OAuth PKCE flow, token management, magic-link, Codex credentials, keychain
- **`src/config/`** — Zod-validated config loader with env var resolution
- **`src/sessions/`** — Session management: per-user/channel conversation state
- **`src/gateway/`** — HTTP server hosting GraphQL API and WebSocket subscriptions
- **`src/cli/`** — CLI commands: start, chat, setup-token, web, secret, bootstrap
- **`src/logging/`** — Structured logging with token/secret redaction
- **`providers/`** — LLM provider plugins (`anthropic/`)
- **`channels/`** — Channel plugins (`slack/`, `web/`)
- **`apps/web/`** — React 19 web app (Vite 6, Tailwind CSS 4, urql)
- **`apps/desktop/`** — Tauri 2 cross-platform tray app (macOS + Windows). Spawns the Node backend as a sidecar and renders `apps/web/` in a webview. See `apps/desktop/README.md`.

## Data Directory Structure

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
├── strategies/              # Trading strategy definitions (Markdown)
├── snap/                    # Snap briefs
├── watchlist/               # Watchlist entries
├── identity/                # Ed25519 device keypair (mode 0o600)
├── audit/                   # Security audit log (append-only)
├── event-log/               # events.jsonl
├── cron/                    # Scheduler job state
├── acp/                     # ACP session mappings
├── cache/                   # Browser sessions, enrichment cache
├── data/                    # Data source outputs and imports
└── logs/                    # Application logs

~/.yojin-vault/              # Encrypted credentials (separate from app data)
└── secrets.json

data/default/                # Factory defaults (git-tracked)
├── persona.default.md
├── connections.default.json
├── data-sources.default.json
├── agents/                  # Per-agent default configs
└── strategies/              # Default trading strategy definitions
```
