# AI Provider Auth: Yojin vs OpenAlice

Side-by-side comparison of how each project handles AI provider authentication, credential storage, and onboarding.

---

## Credential Storage


| Aspect                    | Yojin                                                                    | OpenAlice                                                 |
| ------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------- |
| **Primary store**         | AES-256-GCM encrypted vault (`data/vault/secrets.json`)                  | Plain-text JSON (`data/config/ai-provider-manager.json`)  |
| **Key derivation**        | PBKDF2-SHA512, 600k iterations, per-entry IVs                            | None — raw strings                                        |
| **Env vars**              | `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `YOJIN_VAULT_PASSPHRASE` | `ANTHROPIC_API_KEY` (injected at runtime from config)     |
| **macOS Keychain**        | Reads Claude Code CLI tokens via `security find-generic-password`        | Not used                                                  |
| **Filesystem protection** | Vault file encrypted; `.env` gitignored                                  | Config gitignored; device-auth files written with `0o600` |
| **Supported providers**   | Anthropic, OpenAI, OpenRouter                                            | Anthropic, OpenAI, Google                                 |


### Key Difference

Yojin treats credential storage as a security boundary — secrets are encrypted at rest, injected at the transport layer via `SecretProxy`, and never exposed to LLM prompts. OpenAlice stores API keys as plain JSON and relies on filesystem-level gitignore for protection.

---

## OAuth Support


| Aspect              | Yojin                                                                                                              | OpenAlice                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| **OAuth PKCE**      | Custom implementation (`src/auth/claude-oauth.ts`) — full PKCE S256 flow against `claude.ai/oauth/authorize`       | Delegated entirely to Agent SDK's `forceLoginMethod: 'claudeai'` |
| **Token exchange**  | Handles code exchange, token refresh, JSON + form-urlencoded fallback                                              | SDK handles everything internally                                |
| **Magic link flow** | Playwright-automated email magic link → OAuth code interception                                                    | Not supported                                                    |
| **Token refresh**   | `TokenManager` class — refreshes on 401, writes back to `.env` and `process.env`; keychain source re-reads from OS | SDK handles refresh internally                                   |
| **Token sources**   | Env var → Keychain → Magic link (3 acquisition paths)                                                              | Config file → SDK OAuth (2 paths)                                |


### Key Difference

Yojin owns the full OAuth lifecycle — PKCE generation, code exchange, token refresh, and even an automated magic link flow via Playwright. OpenAlice passes `forceLoginMethod: 'claudeai'` to the Agent SDK and lets the SDK handle everything. This gives Yojin more control (token storage location, refresh strategy, multi-source fallback) but more surface area to maintain.

---

## Runtime Credential Delivery


| Aspect                     | Yojin                                                                                                               | OpenAlice                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **SDK auth**               | `new Anthropic({ apiKey: null, authToken, defaultHeaders: OAUTH_HEADERS })` with custom beta headers and user-agent | Env var injection (`ANTHROPIC_API_KEY`) or deletion (OAuth mode) passed to Agent SDK `query()` |
| **External API auth**      | `SecretProxy` injects `Authorization: Bearer` headers — caller never sees the secret; response bodies are scrubbed  | Direct API key strings passed to SDK constructors                                              |
| **Fallback chain**         | OAuth (env) → OAuth (keychain) → API key → CLI subprocess                                                           | API key → `claudeai` OAuth (Agent SDK)                                                         |
| **Hot-reload**             | `configureOAuthToken()` / `configureApiKey()` reconfigure live provider without restart; config refreshes every 30s | Config re-read from disk on every request                                                      |
| **Multi-provider routing** | `ProviderRouter` with fallback provider on retryable errors (network, 429, 5xx)                                     | `GenerateRouter` reads active backend per-call; no automatic fallback                          |
| **Per-channel overrides**  | Not supported (global provider config)                                                                              | Per web sub-channel provider/model/apiKey overrides via `web-subchannels.json`                 |


### Key Difference

Yojin's `SecretProxy` ensures credentials never leave the vault boundary — they're injected into HTTP requests internally and scrubbed from responses. OpenAlice passes keys directly as constructor params or env vars. OpenAlice has per-channel credential overrides that Yojin lacks.

---

## Onboarding Flow


| Aspect                    | Yojin                                                                                              | OpenAlice                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **UI**                    | Step-by-step web wizard (`Step1AiBrain` React component)                                           | No dedicated UI — runtime API endpoints + manual config editing      |
| **Auto-detection**        | Checks env vars → vault → keychain on mount; auto-accepts env/vault, requires consent for keychain | No auto-detection                                                    |
| **Validation**            | Real 1-token probe request to provider API to verify key works                                     | `/test-provider` endpoint for market data keys; no AI key validation |
| **Keychain consent**      | Explicit user consent required — keychain is passive, env vars indicate intent                     | N/A                                                                  |
| **Credential activation** | Vault store → `process.env` injection → live provider reconfiguration                              | Config file write → next request picks it up                         |
| **Reset**                 | `resetOnboarding` mutation wipes vault keys, persona, briefing, platforms, snapshots               | Manual config file deletion                                          |


### Key Difference

Yojin has a guided onboarding wizard with auto-detection, consent gates, and live validation. OpenAlice expects users to configure credentials through API calls or manual JSON editing — functional but not user-friendly for first-time setup.

---

## Security Posture


| Aspect                      | Yojin                                                                                        | OpenAlice                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Encryption at rest**      | AES-256-GCM with PBKDF2 key derivation                                                       | None                                                          |
| **LLM exposure prevention** | Vault CLI requires TTY for sensitive ops; prompts go to stderr; SecretProxy scrubs responses | API status endpoint only exposes boolean presence, not values |
| **Audit logging**           | All `secret.access` events logged to append-only `security.jsonl`                            | No credential access audit log                                |
| **Rate limiting on auth**   | Onboarding mutations rate-limited (network-exposed API boundary)                             | Gateway auth rate limiter with sliding window + lockout       |
| **Credential scrubbing**    | 7 regex patterns scrubbed from SecretProxy responses                                         | Not implemented                                               |


---

## Summary


| Dimension            | Yojin                                                           | OpenAlice                               |
| -------------------- | --------------------------------------------------------------- | --------------------------------------- |
| **Security depth**   | Deep — encrypted vault, proxy injection, scrubbing, audit trail | Shallow — gitignore + file permissions  |
| **OAuth ownership**  | Full — custom PKCE, magic link, token management                | Delegated — SDK handles it              |
| **Onboarding UX**    | Guided wizard with auto-detect and validation                   | Manual config + API                     |
| **Multi-provider**   | Fallback routing on errors                                      | Per-channel overrides                   |
| **Maintenance cost** | Higher — custom OAuth, vault, proxy all need upkeep             | Lower — leverages SDK for heavy lifting |


### What We Could Adopt from OpenAlice

1. **Per-channel credential overrides** — different API keys per web sub-channel allows users to mix providers across conversations.
2. **Config hot-reload on every request** — simpler than a 30s refresh interval; guarantees immediate pickup of credential changes.
3. **SDK-delegated OAuth as a fallback** — `forceLoginMethod: 'claudeai'` is a one-liner that covers the common case; our custom PKCE could be the upgrade path for advanced control.

### What OpenAlice Could Adopt from Us

1. **Encrypted vault** — plain-text API keys in JSON is a security gap for a finance tool.
2. **Onboarding wizard** — auto-detection + guided setup dramatically improves first-run experience.
3. **SecretProxy pattern** — credential injection at the transport layer with response scrubbing prevents accidental exposure.
4. **Keychain integration** — zero-config path for users who already have Claude Code CLI installed.

