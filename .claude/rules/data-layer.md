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

## Signal publishedAt — Ingestion Time vs Upstream Timestamp

- **Synthetic enrichment signals must use ingestion time (`now`), not the upstream event timestamp.** This applies to all signals derived from Jintel enrichment (snapshots, key price events, short interest, technicals, sentiment). Upstream timestamps (e.g. `event.date` for a 52-week high set last October) point to historical partition files; a `since: "7 days"` query will never scan those files, making the freshly-ingested signal invisible.
- **Preserve the upstream timestamp in `metadata`** (e.g. `metadata.eventDate`) so the original data isn't lost.
- **Exception**: signals with a stable external publish date that users expect to see anchored in time (news articles, research reports, SEC filings) should use their actual `publishedAt` date, as those are read with broad time windows or by-id.

## Signal Title Uniqueness for Dedup

- **Each signal title must be unique per ticker per day.** Content-hash dedup keys on `title | YYYY-MM-DD`. If Jintel returns multiple items of the same type for the same ticker (e.g. 5 LinkedIn posts), they will all hash to the same key and only one survives.
- **Include a differentiator in the title**: tweet author (`@author`), subreddit + post title (`r/sub — title`), video title, or first 60 chars of post text. A bare `"AAPL: LinkedIn post"` dedup-collides immediately.

## Credential Mapping
- API credentials are stored in the encrypted vault and injected at the transport layer.
- Never hardcode keys or include them in LLM prompts.
