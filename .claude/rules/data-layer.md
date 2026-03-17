---
description: Rules for the OpenBB data layer and research tools
globs: ["src/openbb/**/*.ts", "src/research/**/*.ts", "src/news/**/*.ts"]
---

# Data Layer Rules

## OpenBB SDK
- TypeScript-native, in-process. No Python sidecar, no subprocess calls.
- Each asset class has its own SDK module (`equity/`, `crypto/`, `currency/`, `commodity/`, `economy/`).
- SymbolIndex provides zero-latency local lookups — use it instead of API calls for symbol resolution.

## Research Tools
- All research tools register with ToolRegistry via `src/research/adapter.ts`.
- Tools are scoped to the Research Analyst agent — other agents access research results through shared state.
- Technicals formulas work across asset classes: `SMA(CLOSE('AAPL', '1d'), 50)`.

## News System
- Layer 1 (RSS collector) runs in the background, deduplicates via content hash, writes to JSONL archive.
- Layer 2 (OpenBB API) is real-time, on-demand. Results piggybacked into the archive.
- Agent tools (`globNews`, `grepNews`, `readNews`) search the archive — not the live API.

## Credential Mapping
- OpenBB API credentials are mapped through `src/openbb/credential-map.ts`.
- Config keys in `data/config/openbb.json` map to provider-specific API keys (e.g., FMP, Benzinga, EIA, FRED).
