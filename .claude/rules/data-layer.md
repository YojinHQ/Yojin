---
description: Rules for the data layer, Jintel integration, and signal ingestion
globs: ["src/jintel/**/*.ts", "src/signals/**/*.ts", "src/data-sources/**/*.ts"]
---

# Data Layer Rules

## Jintel Integration
- All market data, news, research, technicals, and sentiment flow through `@yojinhq/jintel-client`.
- Batch enrichment via `src/jintel/` — always PII-redact before Jintel API calls.
- Each asset class is handled by Jintel's entity/sub-graph model (market, technicals, news, research, sentiment, risk, regulatory, derivatives).

## Signal Ingestion
- Background pipeline in `src/signals/` pulls from Jintel, deduplicates entries by content hash, extracts ticker mentions via `TickerExtractor`, and writes to the local JSONL archive.
- Agent tools (`globSignals`, `grepSignals`, `readSignals`) search the archive — not the live API.
- Signals are first-class data points with type, tickers, sources, confidence, and link type (DIRECT/INDIRECT/MACRO).

## Data Sources
- Pluggable data-feed framework in `src/data-sources/` — CLI tools, MCP servers, REST APIs under uniform DataQuery/DataResult interface.
- New data sources register via the data source registry and are queryable through agent tools.

## Credential Mapping
- API credentials are stored in the encrypted vault and injected at the transport layer.
- Never hardcode keys or include them in LLM prompts.
