# Yojin — Personal AI Finance Agent

Personal Bloomberg for retail investors. Multi-agent AI system that ingests portfolio data from investment platforms, enriches positions via Jintel API, and delivers personalized portfolio intelligence through signal curation, insight reports, and trading strategy evaluation.

## Architecture

Multi-agent, file-driven architecture. Four specialized agents (Research Analyst, Strategist, Risk Manager, Trader) collaborate through shared state. No database — all state is append-only JSONL files and JSON configs in `~/.yojin/` (or `$YOJIN_HOME`). Vault lives separately in `~/.yojin-vault/`.

Key entry points: `src/composition.ts` (dependency wiring), `src/entry.ts` (main), `src/paths.ts` (all paths).

### Core Modules

- **`src/agents/`** — Agent profiles, orchestrator, registry
- **`src/signals/`** — Signal data model (NEWS, FUNDAMENTAL, SENTIMENT, TECHNICAL, MACRO, FILINGS, SOCIALS, TRADING_LOGIC_TRIGGER), archive with time-windowed retrieval
- **`src/insights/`** — InsightReport (per-position + portfolio synthesis)
- **`src/actions/`** — Action lifecycle (PENDING → APPROVED | REJECTED | EXPIRED)
- **`src/strategies/`** — Markdown trading strategies, StrategyEvaluator
- **`src/guards/`** — Deterministic guard pipeline (security + finance guards)
- **`src/trust/`** — Encrypted vault, PII redactor, approval gate, audit log
- **`src/jintel/`** — Wrapper around `@yojinhq/jintel-client` for enrichment
- **`src/api/graphql/`** — GraphQL API (graphql-yoga on Hono)
- **`apps/web/`** — React 19 web app (Vite 6, Tailwind CSS 4, urql)

See `src/*/` for full module list. See `.claude/rules/` for operational guidance (security, testing, GraphQL, etc.).

## Commands

```bash
pnpm dev              # Start backend + web app in parallel
pnpm dev:be           # Backend only
pnpm dev:fe           # Frontend only (Vite dev server)
pnpm build            # Compile TypeScript
pnpm test             # Run tests (vitest)
pnpm typecheck        # Type checking (tsc --noEmit)
pnpm lint             # ESLint
pnpm ci               # Full CI: format + typecheck + lint + test
pnpm chat             # Interactive chat REPL
pnpm setup            # First-time setup wizard
```

## Tech Stack

- **Runtime**: Node.js >= 22.12, ESM, TypeScript 5.9 strict, pnpm 10
- **Validation**: Zod schemas everywhere
- **AI**: Anthropic SDK, Codex CLI, `@yojinhq/jintel-client`
- **Web**: React 19, Vite 6, Tailwind CSS 4, urql + graphcache
- **API**: graphql-yoga on Hono, graphql-sse subscriptions

## Key Types

- `Signal` — First-class data point: type, tickers, sources, confidence, link type
- `InsightReport` — Per-position insights + portfolio synthesis
- `Action` — Actionable recommendation with lifecycle
- `Guard` — Deterministic check: `check(action) → { pass } | { pass: false, reason }`
- `SecretVault` — Encrypted credentials (PBKDF2 + AES-256-GCM)

## Naming Conventions

| Convention | Example | Usage |
|------------|---------|-------|
| camelCase | `getUserData` | Functions, variables, properties |
| PascalCase | `UserData` | Classes, components, interfaces |
| SCREAMING_SNAKE_CASE | `MAX_RETRIES` | True constants |
| kebab-case | `user-data.ts` | File names, URLs |

## Frontend Design

Always use the `/frontend-design` strategy when building or modifying frontend UI components, pages, or views.
