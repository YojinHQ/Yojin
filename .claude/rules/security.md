---
description: Security and trust rules for the 4-layer trust stack
globs: ["src/trust/**/*.ts", "src/guards/**/*.ts", "src/enrichment/**/*.ts", "src/scraper/**/*.ts"]
---

# Security Rules — Trust & Security Layer

The trust layer is Yojin's core differentiator. Every component must be deterministic and non-bypassable.

## Layer 1: secretctl (Credential Vault)
- Never hardcode secrets. All credentials go through secretctl or environment variables.
- secretctl stores credentials in encrypted SQLite (AES-256-GCM) — never plaintext.
- Credentials are injected at the transport layer, never in LLM prompts.
- The MCP server exposes credentials to AI tools without revealing raw values.
- Never log credentials, tokens, or API keys — even at debug level.
- Never commit `.env` files, browser session data, or `data/cache/` contents.

## Layer 2: RADIUS Guards (Deterministic Pre-Execution)
- Every agent action must pass through the guard pipeline before execution.
- Guards are pure functions — no LLM, no prompt, no interpretation.
- Security guards (fs, command, egress, output-dlp, rate-budget, repetition) protect infrastructure.
- Finance guards (read-only, cooldown, symbol-whitelist) enforce trading rules.
- Three operational postures: Local (30 calls/min, strict), Standard (60 calls/min, dev), Unbounded (120 calls/min, research).
- All guard decisions (pass/block) are logged to the security audit log.

## Layer 3: PII Redactor
- Always run `PiiRedactor.redact()` before sending data to Keelson API or any external service.
- Redact: account IDs, exact balances (use ranges), personal identifiers (email, name).
- OpenBB calls are local/in-process and don't need PII redaction.
- Platform credentials never leave secretctl.

## Layer 4: Approval Gate
- Irreversible actions (trades, new connections, config changes) require human approval.
- Approval requests route to the user's active channel (Telegram/Slack/Web).
- Configurable timeout — auto-deny on expiry.

## Security Audit Log
- All security events are appended to `data/audit/security.jsonl` — append-only, never truncated.
- Event types: guard.pass, guard.block, secret.access, pii.redact, approval.request, approval.result, posture.change.

## Browser Sessions
- Playwright session data (cookies, localStorage) persists in `data/cache/` (gitignored).
- Never log scraped portfolio values at info level — use debug.
