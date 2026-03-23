# Yojin

[![CI](https://github.com/YojinHQ/Yojin/actions/workflows/ci.yml/badge.svg)](https://github.com/YojinHQ/Yojin/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

A local-first AI agent that connects to your investment accounts, delivers personalized intelligence, monitors your portfolio 24/7, and executes trades — across every platform you use.

| | |
|---|---|
| **Unified portfolio view** | All of your accounts in one place. Positions, P&L, and intelligence updated in real time. |
| **Chat** | Tell Yojin what you want — analyze a stock, check your portfolio, place a trade. |
| **Personalized intelligence** | News, sentiment, technical analysis, and macro events based on your actual positions. |
| **Explainable finance** | Before every action, Yojin thinks, explores, reasons, tests, calculates, and asks for your approval. |

## Architecture

Yojin is a multi-agent system built around a central **Orchestrator** that coordinates four specialized agents. Each agent has its own system prompt, tool set, and allowed actions — but they share state through a common data layer rather than calling each other directly.

The **Orchestrator** is the entry point for every workflow — whether triggered by a user message, a scheduled digest, or a market event. It decides which agents to invoke, in what order or in parallel, and assembles their outputs into a coherent response or action. Agents produce structured outputs (PortfolioSnapshot, RiskReport, Signals) that flow through a shared pipeline; no agent has awareness of another's internals.

Underneath the agents, a **plugin system** decouples LLM providers and delivery channels from the runtime. Providers and channels are loaded as plugins at startup, making it straightforward to swap models or add new messaging surfaces without touching agent logic. A **deterministic trust layer** — vault, guard pipeline, PII redactor, and audit log — wraps every action before execution, independent of any agent or provider.

All state is file-driven — JSONL sessions, JSON configs, Markdown personas. No database, no ORM, no containers.

### Agents

| Agent | Role |
|---|---|
| **Analyst** | Ingests signals from Jintel, runs technical analysis (SMA, RSI, BBANDS), extracts tickers from news — the same data a human analyst would use: fundamentals, price data, technicals, 8-K activity, real-time news |
| **Strategist** | Owns the Brain (persona, working memory, emotions). Runs bull/bear debate analysis. Defines strategy — asset allocation, rebalancing rules, entry/exit logic tailored to your goals. |
| **Risk Manager** | Analyzes exposure, concentration, correlation, drawdown. Monitors markets 24/7. Delivers alerts via Telegram and daily portfolio digests. |
| **Trader** | Executes trades on target platforms (Robinhood, Coinbase, IBKR, Schwab, Binance, and more). |

```text
┌─────────────────────────────────────────────────────────────────┐
│                         Your Machine                            │
│                                                                 │
│  ┌──────────────┐    ┌─────────────────┐    ┌───────────────┐  │
│  │  Robinhood   │    │  AgentRuntime   │    │   Channels    │  │
│  │  Coinbase    │───▶│  Orchestrator   │───▶│  Web / MCP    │  │
│  │  IBKR/Schwab │    │                 │    │  ACP / Tg     │  │
│  │  Binance/... │    └────────┬────────┘    └───────────────┘  │
│  └──────────────┘             │                                 │
│                   ┌───────────┼───────────┐                    │
│                   ▼           ▼           ▼                    │
│            ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│            │  Trader  │ │ Analyst  │ │   Risk   │             │
│            │(execute) │ │          │ │ Manager  │             │
│            └────┬─────┘ └────┬─────┘ └────┬─────┘             │
│                 │            │            │                    │
│                 ▼            ▼            ▼                    │
│        PortfolioSnapshot  Signals     RiskReport               │
│                 │            ▲            │                    │
│                 └──────▶  Jintel  ◀───────┘                    │
│                          (signals,                             │
│                          news, sentiment)                      │
│                               │                                │
│                          Strategist                            │
│                         (Brain + Memory)──▶ Insights + Alerts  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Trust Layer: Vault │ Guard Pipeline │ PII │ Audit Log   │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### The Brain (Strategist)

The Strategist is the only stateful agent. Its brain persists across sessions, stored as versioned Markdown and JSON files in `data/brain/`. Each decision checkpoint creates a git-like commit with a diff of working memory state; emotion state is updated after each enriched snapshot.

- **Frontal lobe** — working memory: hypotheses, observations, active reasoning
- **Emotion** — confidence level and risk appetite with rationale
- **Signal memory** — reflects on past signals over time, building a view of what matters for your positions
- **Commit history** — git-like versioned snapshots at decision points

Other agents are stateless — they produce outputs on demand.

### Jintel

Jintel is the intelligence layer that powers Yojin's market awareness. It is accessed via the `DataSourceRegistry` in `src/data-sources/`; signal ingestion runs as a background pipeline in `src/signals/`, writing to a local JSONL archive that agents query via `globSignals`, `grepSignals`, and `readSignals` tools.

- **News signals** — real-time and archived news ingested and indexed by ticker, sector, and macro theme
- **Sentiment** — aggregated market sentiment per asset, updated continuously
- **Entity schema** — a standardized representation of each asset (equity, crypto, commodity) that unifies data from disparate sources into a single queryable model
- **Portfolio-aware processing** — signals are filtered and ranked against your actual positions, so you only see intelligence that's relevant to what you hold
- **Signal memory** — the Strategist builds a running reflection of past signals, tracking which types of events have historically moved your positions

Jintel runs as a separate service. PII redaction runs before every Jintel call — Jintel receives sanitized, anonymized data only.

### AI Providers

| Provider | Notes |
|---|---|
| Anthropic SDK | Default. OAuth or API key. |
| Claude Code | Subprocess mode for extended agentic tasks |
| OpenRouter | Access to 200+ models via a single API |
| OpenAI Codex | OpenAI models via the Codex API |

### Core Components

**AgentRuntime** — the execution engine that drives the agent loop: sends messages to the LLM, dispatches tool calls, streams responses, and enforces token budgets. Each agent profile runs inside the same runtime instance with isolated tool scope and session history.

**ToolRegistry** — central registry where every agent tool is registered and scoped per agent profile. Agents can only invoke tools explicitly granted to their profile; the registry enforces this at dispatch time, before any guard check.

**ProviderRouter** — routes LLM requests to the correct backend (Anthropic, Claude Code, OpenRouter, Codex) based on per-agent configuration. Provider selection is resolved at the profile level, with a global fallback.

**Persistent Memory** — file-backed session store using append-only JSONL. Conversation histories, the Strategist's brain state, and the signal archive all survive process restarts without a database. The event log is a separate append-only JSONL that records every system event for observability.

**Signal Ingestion** — background pipeline in `src/signals/` that pulls from Jintel, deduplicates entries by content hash, extracts ticker mentions via `TickerExtractor`, and writes to the local archive. Agents query the archive at reasoning time rather than hitting the API inline.

**GraphQL API** — graphql-yoga on Hono; exposes typed queries, mutations, and real-time subscriptions for the Web UI. The schema is the single contract between the backend and frontend — the React app reads portfolio state, risk data, agent activity, and signal feeds exclusively through this API.

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

Your data never leaves your machine.

Your credentials, positions, and account details are stored and processed on your computer — not on our servers, not in the cloud. The architecture below enforces this at four independent layers, so no single point of failure can expose your data.

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

Approval requests are routed to the user's active channel (Web, Telegram, MCP) and carry a configurable timeout — unanswered requests auto-deny.

Agents have read access to observe and analyze. They have no write access until you explicitly approve an action. Irreversible operations — executing a trade, adding a new connection — require a confirmation step through your active channel.

## Quick Start

Yojin runs locally on your computer. Interactive install walks you through the initial steps. One command, no account needed.

### Prerequisites

- Node.js >= 22
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

```
yojin                Start the backend server (API + GraphQL)
yojin chat           Chat with Yojin in your terminal
yojin setup          Connect your Claude account (OAuth flow)
yojin web            Start the web dashboard only
yojin secret <cmd>   Manage encrypted credentials
yojin acp            Start ACP (Agent Client Protocol) server
yojin version        Print version
yojin help           Show help
```

### Dev Commands

```bash
pnpm chat          # Interactive chat REPL (start here)
pnpm dev           # Backend + web dashboard
pnpm dev:be        # Backend only
pnpm dev:fe        # Web app only (Vite dev server)
pnpm build         # Compile TypeScript
pnpm start         # Run compiled output
pnpm test          # Run tests (vitest)
pnpm setup         # OAuth setup flow (Claude)
```

## Project Structure

```text
yojin/
├── src/
│   ├── core/           # AgentRuntime, ToolRegistry, ProviderRouter, event log
│   ├── agents/         # Multi-agent profiles and orchestrator
│   ├── brain/          # Strategist's persistent memory, persona, emotion
│   ├── signals/        # Signal ingestion, archive, ticker extraction
│   ├── data-sources/   # Data source registry and interfaces (Jintel)
│   ├── scraper/        # Playwright automation (platforms/)
│   ├── portfolio/      # Snapshot store
│   ├── guards/         # 12-guard safety pipeline (security/ + finance/)
│   ├── trust/          # Vault, PII redaction, approval gate, audit log
│   ├── acp/            # Agent Client Protocol server
│   ├── api/            # GraphQL API (graphql-yoga on Hono)
│   ├── ai-providers/   # Provider router (Anthropic, Claude Code, OpenRouter, Codex)
│   ├── auth/           # Claude OAuth PKCE flow, token manager
│   └── plugins/        # ProviderPlugin + ChannelPlugin interfaces, registry
├── apps/
│   └── web/            # React 19 + Vite 6 + Tailwind CSS 4 dashboard
├── providers/          # LLM provider plugins (anthropic/)
├── channels/           # Messaging channels (web/, telegram/)
├── packages/           # Shared packages
├── data/               # Runtime state — JSONL, configs, snapshots (gitignored)
└── test/               # Test suites (vitest)
```

## Channels

| Channel | Status |
|---|---|
| Web UI | Working (Hono + GraphQL + SSE) |
| MCP / ACP | Working (Claude Desktop / Cursor) |
| Telegram | Working (grammY) |
| Discord | Planned |

## Contributing

We welcome contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

Report vulnerabilities via [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE) for details.
