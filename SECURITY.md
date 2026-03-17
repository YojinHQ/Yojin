# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Yojin, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email **security@yojin.ai** with:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge receipt within 48 hours and aim to provide a fix within 7 days for critical issues.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.x     | Yes       |

## Security Design

Yojin is built with security as a core architectural concern:

- **Encrypted credential vault** — AES-256-GCM encrypted storage via secretctl
- **Deterministic guard pipeline** — RADIUS guards enforce boundaries before every agent action
- **PII redaction** — Personal data stripped before any external API call
- **Approval gate** — Irreversible actions require human confirmation
- **Immutable audit log** — Append-only security event log, never truncated
- **Local-first** — All data stays on your machine

See `CLAUDE.md` and `.claude/rules/security.md` for full security architecture details.
