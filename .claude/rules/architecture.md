---
description: Core architecture rules for the Yojin multi-agent system
globs: ["src/**/*.ts", "providers/**/*.ts", "channels/**/*.ts", "packages/**/*.ts"]
---

# Architecture Rules

## Multi-Agent System
- Four agents: Research Analyst, Strategist, Risk Manager, Trader. Each has its own profile, tool set, system prompt, and session history.
- Agents are profiles within AgentRuntime, NOT separate processes. Same ProviderRouter, different configurations.
- The orchestrator coordinates agents in workflows — don't have agents call each other directly.

## File-Driven State
- All persistent state lives in `data/` as JSONL or JSON files. No database, no ORM.
- Sessions: JSONL files in `data/sessions/`.
- Events: append-only JSONL in `data/event-log/`.
- News archive: JSONL in `data/news-archive/`.
- Snapshots: JSON in `data/snapshots/`.
- Config: JSON with Zod validation in `data/config/`.

## Default/Override Pattern
- Factory defaults go in `data/default/` (git-tracked).
- User overrides go in `data/brain/` or `data/config/` (gitignored).
- First run auto-copies defaults to overrides. `git pull` updates defaults without clobbering user customizations.

## Module Boundaries
- `src/guards/` is generic agent safety — knows nothing about finance. Only enforces boundaries (read-only, rate-limit, cooldown, whitelist).
- `src/risk/` is finance-only analysis — produces RiskReport, never blocks actions.
- `src/trust/` handles credentials (secretctl), action boundaries (RADIUS), PII redaction, and approval flows.
- `src/enrichment/` orchestrates dual-source enrichment (Keelson + OpenBB) — always PII-redact before Keelson calls.

## Plugin System
- Providers live in `providers/<id>/` with `index.ts` entry point.
- Channels live in `channels/<id>/` with `index.ts` entry point.
- Both implement existing interfaces from `src/plugins/types.ts`.
- All tools register with ToolRegistry, scoped per agent profile.

## Composition Root
- `src/main.ts` is the single composition root that wires YojinContext.
- No service locator, no DI container. Explicit construction and dependency passing.
