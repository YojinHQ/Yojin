# Yojin

[![CI](https://github.com/YojinHQ/Yojin/actions/workflows/ci.yml/badge.svg)](https://github.com/YojinHQ/Yojin/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.12-brightgreen)](https://nodejs.org)

A local-first AI agent that connects to your investment accounts, delivers personalized intelligence, monitors your portfolio 24/7, and executes trades — across every platform you use.

|                               |                                                                                                      |
|-------------------------------|------------------------------------------------------------------------------------------------------|
| **Unified portfolio view**    | All of your accounts in one place. Positions, P&L, and intelligence updated in real time.            |
| **Chat**                      | Tell Yojin what you want — analyze a stock, check your portfolio, place a trade.                     |
| **Personalized intelligence** | News, sentiment, technical analysis, and macro events based on your actual positions.                |
| **Explainable finance**       | Before every action, Yojin thinks, explores, reasons, tests, calculates, and asks for your approval. |

## Architecture

Yojin is a multi-agent system built around a central **Orchestrator** that coordinates specialized agents. Each agent has its own role, tool set, and allowed actions — but they share state through a common interoperability layer.

The **Orchestrator** is the entry point for every workflow — whether triggered by a user message, a scheduled digest, or a market event. It decides which agents to invoke, in what order or in parallel, and assembles their outputs into a coherent response or action. Agents produce structured outputs (PortfolioSnapshot, RiskReport, Signals) that flow through a shared pipeline.

All state is file-driven — JSONL sessions, JSON configs, Markdown files. No database, no ORM, no containers.

A **deterministic security layer** — vault, guard pipeline, PII redactor, and audit log — wraps every action before execution.

### Agents

| Agent            | Role                                                                                                                                                                                                                                                                         |
|------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Analyst**      | Ingests signals from Jintel, runs technical analysis (SMA, RSI, BBANDS), extracts tickers from news. Maintains a self-evolving working memory — past analyses, recommendations, and their actual outcomes are stored and retrieved via BM25 to inform every future decision. |
| **Strategist**   | Owns the Brain (persona, working memory, emotions). Runs bull/bear debate analysis. Defines strategy — asset allocation, rebalancing rules, entry/exit logic tailored to your goals.                                                                                         |
| **Risk Manager** | Analyzes exposure, concentration, correlation, drawdown. Monitors markets 24/7. Delivers alerts via Telegram, WhatsApp, and daily portfolio digests.                                                                                                                         |
| **Trader**       | Executes trades on target platforms (Robinhood, Coinbase, IBKR, Schwab, Binance, and more).                                                                                                                                                                                  |

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                              Your Machine                                │
│                                                                          │
│  ┌───────────────┐   ┌─────────────────┐   ┌───────────────┐           │
│  │  Robinhood    │   │  AgentRuntime   │   │   Channels    │           │
│  │  Coinbase     │──▶│  Orchestrator   │──▶│  Web / MCP    │           │
│  │  IBKR/Schwab  │   │  (staged)      │   │  ACP / Slack  │           │
│  │               │   │               │   │  TG / WA      │           │
│  │  Binance/...  │   └───────┬────────┘   └───────────────┘           │
│  └───────────────┘           │                                          │
│                              ▼                                          │
│               ┌──────────────────────────────┐                          │
│               │  STAGE 0 — Research Analyst  │                          │
│               │  portfolio + signals + enrich │                         │
│               └──────────────┬───────────────┘                          │
│                              ▼                                          │
│               ┌──────────────────────────────┐                          │
│               │  STAGE 1 — parallel          │                          │
│               │  ┌────────────┐ ┌──────────┐ │                          │
│               │  │  Research  │ │   Risk   │ │                          │
│               │  │  Analyst   │ │ Manager  │ │                          │
│               │  └────────────┘ └──────────┘ │                          │
│               └──────────────┬───────────────┘                          │
│                              ▼                                          │
│               ┌──────────────────────────────┐                          │
│               │  STAGE 2 — Strategist        │                          │
│               │  (Brain + Memory + Emotion)  │                          │
│               │  synthesis → InsightReport   │                          │
│               └──────────────┬───────────────┘                          │
│                              ▼                                          │
│                    ┌───────────────────┐                                 │
│                    │      Jintel       │                                 │
│                    │ (intelligence     │                                 │
│                    │  layer)           │                                 │
│                    └────────┬──────────┘                                 │
│            ┌────────────────┼────────────────┐                          │
│            ▼                ▼                ▼                          │
│     ┌────────────┐  ┌────────────┐  ┌────────────┐                     │
│     │  News &    │  │ Market &   │  │  Custom    │                     │
│     │ Sentiment  │  │ Financials │  │  Sources   │                     │
│     │  Feeds     │  │   APIs     │  │ (Sheets,   │                     │
│     └────────────┘  └────────────┘  │  DBs, ...) │                     │
│                                     └────────────┘                     │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Trust Layer: Vault │ Guard Pipeline │ PII │ Audit Log            │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

### The Brain (Strategist)

The Strategist's brain persists across sessions, stored as versioned Markdown and JSON files in `data/brain/`. Each decision checkpoint creates a git-like commit with a diff of working memory state.

- **Frontal lobe** — working memory: hypotheses, observations, active reasoning
- **Emotion** — confidence level and risk appetite with rationale
- **Signal memory** — reflects on past signals over time, building a view of what matters for your positions
- **Commit history** — git-like versioned snapshots at decision points

### Memory System

Agents learn from their own track record. Analysis produces a `(situation, recommendation, outcome)` tuple stored in a per-role memory file. When the agent faces a new decision, BM25Okapi retrieval surfaces the most lexically similar past situations — and what actually happened after acting on them.

After an evaluation window closes (configurable: 1d, 7d, 30d), the reflection engine compares the predicted direction against the actual market outcome, grades the call (CORRECT / PARTIALLY_CORRECT / INCORRECT), and writes a structured lesson back into memory. That lesson is injected into future prompts automatically — no retraining, no embeddings, no external API.

Each agent role maintains an independent store:

| Role     | Memory Contains                   |
|----------|-----------------------------------|
| Bull     | Past bullish arguments + outcomes |
| Bear     | Past bearish arguments + outcomes |
| Research | Past judge decisions + outcomes   |
| Risk     | Past risk assessments + outcomes  |

Fully offline — BM25 only, no vector database. Configurable capacity (default 1,000 entries per role) with pruning when exceeded. Persisted as local JSON in `data/memory/`.

### Jintel

Jintel is the intelligence layer that powers Yojin's market awareness. Accessed via `@yojinhq/jintel-client`, it provides batch enrichment across eight data domains — all ingested as signals into the local JSONL archive that agents query via `globSignals`, `grepSignals`, and `readSignals` tools.

- **Market data** — real-time quotes, fundamentals (P/E, EPS, market cap, 52-week range), and significant price moves
- **Risk signals** — sanctions screening, adverse media, regulatory actions, litigation, and PEP flags
- **Regulatory filings** — SEC filings (10-K, 10-Q, 8-K) indexed by ticker
- **Technical indicators** — RSI, MACD, Bollinger Bands, EMA, SMA, ATR, VWMA, MFI
- **News** — real-time news from multiple sources, ingested and indexed by ticker
- **Research** — web research results, scored by relevance
- **Social sentiment** — social media rank, mention count, upvote trends, and 24h momentum per ticker
- **Macro indicators** — GDP, inflation, interest rates, S&P 500 P/E and CAPE ratios
- **Portfolio-aware processing** — signals are scored and ranked against your actual positions via the curation pipeline, so you only see intelligence relevant to what you hold

PII redaction runs before every Jintel call — Jintel receives sanitized, anonymized data only.

### Core Components

**AgentRuntime** — the execution engine that drives the agent loop: sends messages to the LLM, dispatches tool calls, streams responses, and enforces token budgets. Each agent profile runs inside the same runtime instance with isolated tool scope and session history.

**ToolRegistry** — central registry where every agent tool is registered and scoped per agent profile. Agents can only invoke tools explicitly granted to their profile; the registry enforces this at dispatch time, before any guard check.

**ProviderRouter** — routes LLM requests to the correct backend (Anthropic, Claude Code, OpenRouter, Codex) based on per-agent configuration. Provider selection is resolved at the profile level, with a global fallback.

**Persistent Memory** — file-backed session store using append-only JSONL. Conversation histories, the Strategist's brain state, and the signal archive all survive process restarts without a database. The event log is a separate append-only JSONL that records every system event for observability.

**Watchlist** — JSONL-backed watchlist store in `src/watchlist/` with Jintel enrichment. Symbols are persisted with in-memory Map cache; enrichment data (quote, news, risk score) is cached locally with configurable TTL and refreshed lazily on access. Three agent tools: `watchlist.add`, `watchlist.remove`, `watchlist.list`.

**Signal Ingestion** — background pipeline in `src/signals/` that pulls from Jintel, deduplicates entries by content hash, extracts ticker mentions via `TickerExtractor`, and writes to the local archive. Agents query the archive at reasoning time rather than hitting the API inline.

**ProcessInsights Workflow** — multi-agent pipeline in `src/insights/` that pre-aggregates portfolio data, triages positions (hot/warm/cold), then runs Research Analyst → Risk Manager → Strategist. Produces structured `InsightReport`s with per-position ratings, conviction scores, key signals, risks, and opportunities. Portfolio-level items (action items, risks, opportunities) are structured objects with deterministically-assigned signal references — signal IDs are matched to positions by ticker mention, not by the LLM. Reports are stored as append-only JSONL and surfaced in the Web UI via GraphQL.

**GraphQL API** — graphql-yoga on Hono; exposes typed queries, mutations, and real-time subscriptions for the Web UI. The schema is the single contract between the backend and frontend — the React app reads portfolio state, risk data, agent activity, and signal feeds exclusively through this API. The schema uses GraphQL enums for all fixed-value fields (signal types, sentiment, verdicts, severities) and `ID!` for all entity identifiers, enabling compile-time validation on both client and server.

```graphql
# Query available tiers
query { detectAvailableTiers(platform: COINBASE) { tier, available, requiresCredentials } }

# Connect (async — subscribe to onConnectionStatus for progress)
mutation { connectPlatform(input: { platform: COINBASE, tier: API }) { success, error } }

# List active connections
query { listConnections { platform, tier, status, lastSync } }

# Disconnect
mutation { disconnectPlatform(platform: COINBASE, removeCredentials: true) { success } }
```

## Security & Privacy

Your credentials, positions, and account details are stored and processed on your computer — not on our servers, not in the cloud. Sensitive data is scrubbed before it reaches the AI model.

The architecture below enforces this at four independent layers, so no single point of failure can expose your data.

### Layer 1 — Credential Vault

**Your secrets stay encrypted, on-disk, on your machine.**

API keys and credentials are stored in a local encrypted vault using AES-256-GCM with per-entry IVs; the key is derived via PBKDF2 (600k iterations, SHA-512). A canary entry verifies the passphrase on unlock without decrypting real secrets.

The vault never makes network requests. When an AI agent needs a credential at runtime, it reads from the vault locally — the key is never hardcoded, logged, or transmitted.

```text
┌──────────────────────────────────────────────┐
│               Encrypted Vault                 │
│                                               │
│  Passphrase ──▶ PBKDF2 (600k, SHA-512)       │
│  (optional)          │                        │
│                 Derived Key                    │
│                      │                        │
│              ┌───────┴───────┐                │
│              │  AES-256-GCM  │                │
│              │  per-entry IV │                │
│              └───────┬───────┘                │
│                      │                        │
│  ┌───────────────────┼───────────────────┐    │
│  │  KEY_A: ████████  │  KEY_B: ████████  │    │
│  │  KEY_C: ████████  │  KEY_D: ████████  │    │
│  └───────────────────┴───────────────────┘    │
│                                               │
│  Canary: verifies passphrase on unlock        │
│  Key names: plaintext (enables list w/o key)  │
│  MCP server: injects creds at transport layer │
│  Raw values: NEVER in LLM prompts             │
└──────────────────────────────────────────────┘
```

When connecting a platform, the LLM never sees your API key. The CLI switches to a secure side-channel for collection:

```text
  LLM Conversation                     Secure Side-Channel (TTY)
  ────────────────                     ─────────────────────────
  "Connect your Binance account"
         │
         ▼
  tool_call: store_credential
    key: "BINANCE_API_KEY"
    desc: "Binance API key"
         │
         │                      ┌─────────────────────────────┐
         │                      │  Prompt on stderr            │
         │                      │  (LLM reads stdout only)     │
         │                      │                              │
         │                      │  > Enter BINANCE_API_KEY:    │
         │                      │    ••••••••••••••••          │
         │                      │    (raw mode, echo off)      │
         │                      │                              │
         │                      │  Value ──▶ Encrypted Vault   │
         │                      │           (AES-256-GCM)      │
         │                      └─────────────────────────────┘
         ▼
  tool_result: "Credential
    'BINANCE_API_KEY' stored."
         │
         ▼                        Later, when a tool needs it:
  Conversation continues            SecretProxy retrieves from vault
  (secret never in context)         ──▶ injects into HTTP headers
                                    ──▶ scrubs response body
                                    ──▶ returns safe result to LLM
```

- **stderr prompts** — LLM only reads stdout, never sees the input prompt
- **TTY raw mode, echo disabled** — nothing printed while you type
- **Non-TTY rejection** — refuses piped input, preventing LLM from feeding secrets programmatically
- **Transport-layer injection** — credentials go from vault directly into HTTP headers, never into prompts

### Layer 2 — Deterministic Guard Pipeline

**Rules that can't be reasoned with.**

Guards are pure functions — `check(action) → { pass } | { pass: false, reason }`. The pipeline is locked after initialization; no runtime modification is possible. Three operational postures (Local / Standard / Unbounded) control rate limits and enforcement strictness.

Before any agent action executes, it passes through a pipeline of security guards — code-based rules with binary outcomes. A regex either matches or it doesn't. The AI cannot persuade, interpret, or work around them.

12 guards run in sequence: kill switch, self-defense, tool policy, filesystem, command, egress, output-DLP, rate budget, repetition, read-only, cooldown, and symbol whitelist. Every decision — pass or block — is written to the tamper-evident audit log.

### Layer 3 — PII Redaction

**Sensitive data is scrubbed before it reaches any AI model.**

Chat messages run through Rehydra (regex + optional NER) with a reversible AES-256-GCM encrypted PII map, so responses are rehydrated before the user sees them. Structured snapshots use SHA-256 hashing for account IDs and range-bucketing for balances before any external API call.

```text
User: "my email is dean@test.com"
        │
        ▼
  ChatPiiScanner.scrub()     ◀── regex (email, phone, card, IP, URL, IBAN)
        │                         + optional NER (names, orgs, locations)
        ▼
LLM sees: "my email is <PII type="EMAIL" id="1"/>"
        │
        ▼
  ChatPiiScanner.restore()   ◀── AES-256-GCM encrypted PII map
        │
        ▼
User sees: "Got it, I noted dean@test.com"
```

Enable NER for name/org detection: `YOJIN_PII_NER=1`

Portfolio snapshots are redacted before any external API call:

```text
Raw Snapshot                    Redacted Snapshot
┌─────────────────┐            ┌──────────────────┐
│ accountId: 1234 │  SHA-256   │ accountId:        │
│                 │ ────────▶  │  <ACCT-a1b2c3d4>  │
│ balance: 75000  │  range     │ balance:          │
│                 │ ────────▶  │  $50k-$100k       │
│ email:          │  strip     │ email:            │
│  john@test.com  │ ────────▶  │  <EMAIL-REDACT>   │
│ ownerName:      │  strip     │ ownerName:        │
│  John Doe       │ ────────▶  │  <NAME-REDACT>    │
│ symbol: AAPL    │  preserve  │ symbol: AAPL      │
│ price: 150.25   │ ────────▶  │ price: 150.25     │
└─────────────────┘            └──────────────────┘
  Original NEVER mutated          Logged to audit
```

### Layer 4 — Approval Gate

**The agent can think. It cannot act without you.**

Approval requests are routed to the user's active channel (Web, Telegram, WhatsApp, MCP) and carry a configurable timeout — unanswered requests auto-deny.

Agents have read access to observe and analyze. They have no write access until you explicitly approve an action. Irreversible operations — executing a trade, adding a new connection — require a confirmation step through your active channel.

## Quick Start

Yojin runs locally on your computer. Interactive install walks you through the initial steps. One command, no account needed.

### Prerequisites

- Node.js >= 22.12
- pnpm 10+

### Install

```bash
git clone https://github.com/YojinHQ/Yojin.git
cd Yojin
pnpm install
pnpm chat
```

On first launch, Yojin bootstraps itself: connects an LLM provider (paste an Anthropic API key or run the OAuth flow) and generates a personalized Strategist persona based on your investment style. No manual config files needed.

### CLI Usage

Yojin ships a CLI entry point (`yojin`) with the following commands:

```text
yojin                Start the backend server (API + GraphQL)
yojin chat           Chat with Yojin in your terminal
yojin setup          Connect your Claude account (OAuth flow)
yojin web            Start the web dashboard only
yojin secret <cmd>   Manage encrypted credentials
yojin acp            Start ACP (Agent Client Protocol) server
yojin version        Print version
yojin help           Show help
```

### Docker

Run Yojin in Docker — one command gives you the web UI, API, and channel integrations (Slack, etc.):

```bash
./docker-setup.sh
```

The setup script prompts for your API keys, builds the image, and starts everything. Once running:

| Service | URL                            |
|---------|--------------------------------|
| Web UI  | `http://localhost:8080`        |
| API     | `http://localhost:3000`        |
| Health  | `http://localhost:3000/health` |

Or run manually:

```bash
cp .env.example .env.docker        # Edit with your keys
docker compose --env-file .env.docker up -d
```

Stop with `docker compose down`. Data persists in Docker volumes (`yojin_data`, `yojin_vault`).

### Dev Commands

```bash
pnpm chat          # Interactive chat REPL (start here)
pnpm dev           # Backend + web dashboard (concurrent)
pnpm dev:be        # Backend only
pnpm dev:fe        # Web app only (Vite dev server)
pnpm build         # Compile TypeScript
pnpm start         # Run compiled output
pnpm test          # Run tests (vitest)
pnpm ci            # Full CI check (format, typecheck, lint, test)
pnpm setup         # OAuth setup flow (Claude)
pnpm storybook     # Start Storybook for web components
```

## Project Structure

```text
yojin/
├── src/
│   ├── core/           # AgentRuntime, ToolRegistry, ProviderRouter, event log
│   ├── agents/         # Multi-agent profiles and orchestrator
│   ├── brain/          # Strategist's persistent memory, persona, emotion
│   ├── memory/         # BM25 memory store, reflection engine, per-role learning
│   ├── insights/       # ProcessInsights workflow, insight reports, data gatherer, triage, signal assignment
│   ├── signals/        # Signal ingestion, archive, ticker extraction
│   ├── jintel/         # Jintel client, signal fetcher, agent tools, price provider
│   ├── data-sources/   # Data source registry and interfaces (Jintel)
│   ├── scraper/        # Playwright automation (platforms/)
│   ├── portfolio/      # Snapshot store
│   ├── watchlist/      # JSONL-backed watchlist with Jintel enrichment
│   ├── guards/         # 12-guard safety pipeline (security/ + finance/)
│   ├── trust/          # Vault, PII redaction, approval gate, audit log
│   ├── security/       # Security utilities
│   ├── identity/       # Device identity
│   ├── hooks/          # Lifecycle hooks
│   ├── acp/            # Agent Client Protocol server
│   ├── api/            # GraphQL API (graphql-yoga on Hono)
│   ├── ai-providers/   # Provider router (Anthropic, Claude Code, OpenRouter, Codex)
│   ├── auth/           # Claude OAuth PKCE flow, token manager
│   ├── plugin-sdk/     # Plugin SDK exports
│   └── plugins/        # ProviderPlugin + ChannelPlugin interfaces, registry
├── apps/
│   └── web/            # React 19 + Vite 8 + Tailwind CSS 4 dashboard
├── providers/          # LLM provider plugins (anthropic/)
├── channels/           # Messaging channels (slack/, telegram/, whatsapp/, web/)
├── data/               # Runtime state — JSONL, configs, snapshots (gitignored)
└── test/               # Test suites (vitest)
```

## Channels

| Channel   | Status                            |
|-----------|-----------------------------------|
| Web UI    | Working (Hono + GraphQL + SSE)    |
| MCP / ACP | Working (Claude Desktop / Cursor) |
| Slack     | Working (@slack/bolt)             |
| Telegram  | Working (grammy)                  |
| WhatsApp  | Working (Baileys)                 |

## Tech Stack

- **TypeScript** — strict mode, ESM, Node.js 22.12+
- **Anthropic SDK** — Claude as the default AI provider
- **Hono + graphql-yoga** — Web server and GraphQL API with subscriptions
- **Playwright** — browser automation for scraping investment platforms
- **Rehydra** — reversible PII masking in chat (regex + optional NER)
- **Zod** — schema validation for all external data
- **vitest** — testing
- **tslog** — structured logging
- **React 19** — Web UI with Vite 8, Tailwind CSS 4, Storybook
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

## Contributing

We welcome contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

Report vulnerabilities via [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE) for details.
