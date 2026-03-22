---
description: Security and trust rules for the 4-layer trust stack
globs: ["src/trust/**/*.ts", "src/guards/**/*.ts", "src/enrichment/**/*.ts", "src/scraper/**/*.ts"]
---

# Security Rules — Trust & Security Layer

The trust layer is Yojin's core differentiator. Every component must be deterministic and non-bypassable.

## Layer 1: Credential Vault
- Never hardcode secrets. All credentials go through the encrypted vault or environment variables.
- The vault stores credentials in an encrypted JSON file (AES-256-GCM) — never plaintext.
- Credentials are injected at the transport layer, never in LLM prompts.
- The MCP server exposes credentials to AI tools without revealing raw values.
- Never log credentials, tokens, or API keys — even at debug level.
- Never commit `.env` files, browser session data, or `data/cache/` contents.
- **Rate-limit auth endpoints.** Any GraphQL mutation or API endpoint that accepts a passphrase/password/token must have brute-force protection (attempt counter + exponential backoff/lockout). CLI TTY access is an implicit rate limit; network-exposed APIs are not.

## Layer 2: Guard Pipeline (Deterministic Pre-Execution)
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
- Platform credentials never leave the vault.
- **Reconstruction vectors.** When stripping a field to prevent balance reconstruction, check for _all_ paths to reconstruct it. `quantity × currentPrice = marketValue`, and `quantity × public_price ≈ marketValue`. Strip or bucket all fields that form a reconstruction chain.
- **LLM tool output is an external boundary.** The LLM should see balance ranges (`$10k-$50k`) and bucketed quantities (`1-10 units`), never exact dollar amounts or exact quantities. The UI reads exact values directly via GraphQL.
- **`isBalanceField` completeness.** When adding a new numeric balance field to any type, also add its key to `isBalanceField` in the redactor. Test that the redacted output has `typeof field === 'string'`.
- **Screenshot PII masking.** `screenshotOnFailure` injects CSS blur before capture. Both injection and cleanup are best-effort — a screenshot without masking is better than no screenshot at all.

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
