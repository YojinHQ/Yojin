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

| Agent                | Role                                                                     |
|----------------------|--------------------------------------------------------------------------|
| **Research Analyst** | Gathers market data via OpenBB SDK, enriches positions, searches news    |
| **Strategist**       | Reads persona + data + risk reports, produces recommendations and alerts |
| **Risk Manager**     | Analyzes portfolio exposure, concentration, correlation, drawdown        |
| **Trader**           | Scrapes platforms, tracks positions, executes trades (Phase 2)           |

All state is file-driven — JSONL sessions, JSON configs, Markdown personas. No database, no containers.

```text
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
│  │ Trust Layer: Vault │ Guard Pipeline │ PII │ Audit Log    │  │
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

```text
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
│   ├── alerts/         # Alert engine and morning digest builder
│   ├── api/            # GraphQL API (graphql-yoga on Hono) — queries, mutations, subscriptions
│   ├── tools/          # Agent tools registered with ToolRegistry
│   └── plugins/        # Plugin system (ProviderPlugin, ChannelPlugin)
├── apps/
│   └── web/            # React web app (Vite + React 19 + Tailwind 4)
├── providers/          # LLM providers (anthropic/)
├── channels/           # Messaging channels (slack/, telegram/, web/)
├── packages/           # Shared packages (keelson-client/)
├── data/               # Runtime state — JSONL, configs, snapshots (gitignored)
└── test/               # Test suites
```

## Commands

| Command                        | Description                           |
|--------------------------------|---------------------------------------|
| `pnpm dev`                     | Start development server (tsx)        |
| `pnpm chat`                    | Interactive chat REPL                 |
| `pnpm build`                   | Compile TypeScript                    |
| `pnpm start`                   | Run compiled output                   |
| `pnpm test`                    | Run tests (vitest)                    |
| `pnpm lint`                    | Lint with ESLint                      |
| `pnpm clean`                   | Remove dist/                          |
| `pnpm dev -- secret set <key>` | Store an encrypted secret             |
| `pnpm dev -- secret list`      | List stored secret names              |
| `pnpm dev:web`                 | Start React web app (Vite dev server) |
| `pnpm dev:all`                 | Start backend + web app in parallel   |
| `pnpm build:web`               | Build React web app                   |
| `pnpm build:all`               | Build all packages                    |
| `pnpm test:all`                | Run tests across all packages         |
| `pnpm ci:all`                  | Full CI check across all packages     |

## Channels

| Channel  | Status                            |
|----------|-----------------------------------|
| Slack    | Working (@slack/bolt)             |
| Telegram | Phase 1 (grammy)                  |
| Web UI   | Working (Hono + GraphQL + SSE)    |
| MCP      | Phase 1 (Claude Desktop / Cursor) |
| Discord  | Future                            |

## Trust & Security Stack

Yojin is built with security as a first-class concern. Every agent action passes through a deterministic, non-bypassable guard pipeline before execution. No LLM is ever in the security decision loop.

```text
┌─────────────────────────────────────────────────────────────────────┐
│                        Guard Pipeline                               │
│                                                                     │
│  Agent Action                                                       │
│       │                                                             │
│       ▼                                                             │
│  ┌─────────────┐   TRIPPED?                                        │
│  │ Kill Switch  │──── YES ──▶ DENY ALL (emergency halt)             │
│  └──────┬──────┘                                                    │
│         │ NO                                                        │
│         ▼                                                           │
│  ┌─────────────┐   WRITE TO PROTECTED FILE?                        │
│  │Self-Defense  │──── YES ──▶ BLOCK + trip kill switch              │
│  └──────┬──────┘                                                    │
│         │ NO                                                        │
│         ▼                                                           │
│  ┌─────────────┐   TOOL DENIED / BAD INPUT?                        │
│  │ Tool Policy  │──── YES ──▶ BLOCK                                 │
│  └──────┬──────┘                                                    │
│         │ OK                                                        │
│         ▼                                                           │
│  ┌─────────────────────────────────────────┐                        │
│  │         Infrastructure Guards            │                       │
│  │  ┌────────┐ ┌─────────┐ ┌────────────┐  │                       │
│  │  │fs-guard│ │cmd-guard│ │egress-guard│  │  ◀── blocklist-based   │
│  │  └────────┘ └─────────┘ └────────────┘  │                       │
│  │  ┌──────────┐ ┌───────────┐ ┌────────┐  │                       │
│  │  │output-dlp│ │rate-budget│ │repet.  │  │  ◀── pattern + rate    │
│  │  └──────────┘ └───────────┘ └────────┘  │                       │
│  └──────────────────┬──────────────────────┘                        │
│                     │                                               │
│                     ▼                                               │
│  ┌─────────────────────────────────────────┐                        │
│  │          Finance Guards                  │                       │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ │                       │
│  │  │read-only │ │ cooldown │ │whitelist │ │  ◀── trading rules     │
│  │  └──────────┘ └──────────┘ └──────────┘ │                       │
│  └──────────────────┬──────────────────────┘                        │
│                     │                                               │
│                     ▼                                               │
│               ┌───────────┐                                         │
│               │ APPROVED? │──── needs approval ──▶ Approval Gate    │
│               └─────┬─────┘                       (human-in-loop)   │
│                     │                                               │
│                     ▼                                               │
│              ┌────────────┐                                         │
│              │  EXECUTE   │                                         │
│              └──────┬─────┘                                         │
│                     │                                               │
│                     ▼                                               │
│              ┌────────────┐                                         │
│              │ Output DLP │──── leaked secret? ──▶ SUPPRESS OUTPUT  │
│              └──────┬─────┘                                         │
│                     │                                               │
│                     ▼                                               │
│               Return Result                                         │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Audit Log: HMAC-chained JSONL — every decision logged        │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### Three Operational Postures

```text
┌──────────────┬──────────────┬──────────────┐
│    LOCAL     │   STANDARD   │  UNBOUNDED   │
│  (default)   │    (dev)     │  (research)  │
├──────────────┼──────────────┼──────────────┤
│ 30 calls/min │ 60 calls/min │120 calls/min │
│   enforce    │   enforce    │   observe    │
│  read-only   │  read/write  │  read/write  │
│  max safety  │  balanced    │  log only    │
└──────────────┴──────────────┴──────────────┘
```

### Credential Vault

```text
┌──────────────────────────────────────────────┐
│               Encrypted Vault                 │
│                                               │
│  Passphrase ──▶ PBKDF2 (600k, SHA-512)       │
│                      │                        │
│                 Derived Key                    │
│                      │                        │
│              ┌───────┴───────┐                │
│              │  AES-256-GCM  │                │
│              │  per-entry IV  │                │
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

### Secure Credential Input

When connecting a platform (e.g. Binance), the LLM never sees your API key. The CLI switches to a secure side-channel for collection:

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
         │
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

**Key protections:**

- **stderr prompts** — LLM only reads stdout, never sees the input prompt
- **TTY raw mode, echo disabled** — nothing printed while you type
- **Non-TTY rejection** — refuses piped input, preventing LLM from feeding secrets programmatically
- **Transport-layer injection** — credentials go from vault directly into HTTP headers, never into prompts

### Platform Connections

Connect investment platforms via the chat REPL or GraphQL API. The ConnectionManager handles tier detection, credential storage, validation, and first scrape.

**Integration tiers** (best to worst): CLI > API > UI > Screenshot. Each platform supports a subset.

**Chat flow:**

```text
You:   "Connect my Coinbase"
Yojin: Calls connect_platform({ platform: 'COINBASE' })
       → "Available tiers: API (needs API_KEY, API_SECRET), Screenshot (no creds)"
Yojin: "API is the best option. I'll need your API key and secret."
       Calls store_credential({ key: 'COINBASE_API_KEY' })
       → Secure TTY prompt (hidden input) → stored in vault
       Calls store_credential({ key: 'COINBASE_API_SECRET' })
       → Same flow
       Calls connect_platform({ platform: 'COINBASE', tier: 'API' })
       → Validates connection, runs test scrape
       → "Connected! Found 12 positions."
```

**Configuration files** (created automatically, not hand-edited):

| File                               | Purpose                                                    | Created when                  |
|------------------------------------|------------------------------------------------------------|-------------------------------|
| `data/config/connections.json`     | Which platforms are connected, with what tier and settings | First `connect_platform` call |
| `data/cache/connection-state.json` | Runtime state — status, last sync time, last error         | First `connect_platform` call |

**Credential overrides** (optional, hand-edited):

To customize which credentials a platform/tier requires, create `data/config/platform-credentials.json`:

```json
{
  "COINBASE": {
    "API": ["MY_CUSTOM_KEY", "MY_CUSTOM_SECRET"]
  }
}
```

Only specify entries you want to override — everything else falls back to the [hardcoded defaults](src/scraper/platform-credentials.ts).

**GraphQL API:**

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

### PII Protection (Two Layers)

**Layer 1: Chat Pipeline** — Masks PII in user messages before they reach the LLM, powered by [Rehydra](https://github.com/rehydra-ai/rehydra-sdk). Responses are rehydrated so the user sees original values.

```text
User: "my email is dean@test.com"
        │
        ▼
  ChatPiiScanner.scrub()          ◀── regex (email, phone, card, IP, URL, IBAN)
        │                              + optional NER (names, orgs, locations)
        ▼
LLM sees: "my email is <PII type="EMAIL" id="1"/>"
        │
        ▼
  ChatPiiScanner.restore()        ◀── AES-256-GCM encrypted PII map
        │
        ▼
User sees: "Got it, I noted dean@test.com"
```

Enable NER for name/org detection: `YOJIN_PII_NER=1`

**Layer 2: Structured Data** — Redacts PII in portfolio snapshots before external API calls (Keelson).

```text
Raw Snapshot                    Redacted Snapshot
┌─────────────────┐            ┌─────────────────┐
│ accountId: 1234 │  ────▶     │ accountId:      │
│                 │  SHA-256   │  <ACCT-a1b2c3d4> │
│ balance: 75000  │  ────▶     │ balance:        │
│                 │  range     │  $50k-$100k      │
│ email:          │  ────▶     │ email:          │
│  john@test.com  │  strip     │  <EMAIL-REDACT> │
│ ownerName:      │  ────▶     │ ownerName:      │
│  John Doe       │  strip     │  <NAME-REDACT>  │
│ symbol: AAPL    │  ────▶     │ symbol: AAPL    │
│                 │  preserve  │                 │
│ price: 150.25   │  ────▶     │ price: 150.25   │
│                 │  preserve  │                 │
└─────────────────┘            └─────────────────┘
     Original NEVER mutated         Logged to audit
```

### HMAC-Chained Audit Log

```text
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ Event 0  │───▶│ Event 1  │───▶│ Event 2  │───▶│ Event 3  │
│          │    │          │    │          │    │          │
│ prevHash:│    │ prevHash:│    │ prevHash:│    │ prevHash:│
│  000...  │    │  hash(0) │    │  hash(1) │    │  hash(2) │
│ hash:    │    │ hash:    │    │ hash:    │    │ hash:    │
│  HMAC(0) │    │  HMAC(1) │    │  HMAC(2) │    │  HMAC(3) │
└──────────┘    └──────────┘    └──────────┘    └──────────┘

Tamper with any event ──▶ chain breaks ──▶ verifyChain() detects it
Delete an event        ──▶ prevHash gap  ──▶ verifyChain() detects it
```

### Security Highlights

- **Encrypted credential vault** — AES-256-GCM with PBKDF2 key derivation. Credentials injected at the transport layer, never exposed to the LLM.
- **12 deterministic guards** — Kill switch, self-defense, tool policy, fs, command, egress, output-dlp, rate-budget, repetition, read-only, cooldown, symbol-whitelist.
- **PII protection** — Chat messages scrubbed before LLM via Rehydra (email, phone, card, IP, URL + optional NER for names). Structured data redacted before external APIs (account IDs hashed, balances ranged).
- **Human approval gate** — Irreversible actions (trades, new connections) require explicit approval via your active channel.
- **HMAC-chained audit log** — Tamper-evident append-only JSONL. Every security event logged, chain integrity verifiable.
- **Pipeline freeze** — Guard pipeline locked after initialization. No runtime modification possible.
- **Local-first** — Your data stays on your machine. No cloud database, no containers, no third-party data storage.

## Tech Stack

- **TypeScript** — strict mode, ESM, Node.js 20+
- **Anthropic SDK** — Claude as the default AI provider
- **Hono + graphql-yoga** — Web server and GraphQL API with subscriptions
- **Playwright** — browser automation for scraping investment platforms
- **Rehydra** — reversible PII masking in chat (regex + optional NER)
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
