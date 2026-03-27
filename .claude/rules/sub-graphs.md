# Sub-Graph Usage

## Prefer nested sub-graphs over separate top-level queries

When a client (Yojin or any consumer) needs data from multiple domains for the same ticker/entity, use nested sub-graphs instead of separate queries. This reduces round trips and lets Mercurius loaders batch and deduplicate upstream calls.

### Available sub-graphs

| Parent Type | Sub-graph | Data |
|---|---|---|
| `Entity` | `market` | Quote, fundamentals, history |
| `Entity` | `risk` | OFAC sanctions, risk signals |
| `Entity` | `regulatory` | Sanctions, SEC filings |
| `Entity` | `corporate` | Legal name, officers, jurisdiction |
| `Entity` | `technicals` | RSI, MACD, BB, EMA, SMA, ATR, VWMA, MFI |
| `Entity` | `derivatives` | Futures curve, options chain (crypto only) |
| `Entity` | `news` | News articles via Serper |
| `Entity` | `research` | Web research via Exa |
| `MarketQuote` | `technicals` | Technical indicators |
| `MarketQuote` | `derivatives` | Derivatives data (crypto only) |
| `CryptoQuote` | `technicals` | Technical indicators |
| `CryptoQuote` | `derivatives` | Derivatives data |

### Do

```graphql
# Single call gets everything
query {
  quotes(tickers: ["AAPL", "BTC"]) {
    price changePercent
    technicals { rsi macd { histogram } }
    derivatives { futures { expiration price } }
  }
}
```

### Don't

```graphql
# Separate calls for the same tickers — wasteful
query { quotes(tickers: ["AAPL"]) { price } }
query { technicalsBatch(tickers: ["AAPL"]) { rsi } }
```

### When adding new data sources

When creating a new connector that provides entity-level data:
1. Wire it as a sub-graph on `Entity` (loader in `entityLoaders.Entity`)
2. If the data is also useful on `MarketQuote` or `CryptoQuote`, add it there too using the shared loader factories (`createTechnicalsLoader`, `createDerivativesLoader`, or a new factory)
3. Top-level queries are still fine for standalone use cases (e.g. `sanctionsScreen` for ad-hoc screening without an entity)

## Single source of truth per data domain

Every piece of data must have exactly one canonical query path. Never expose the same data through multiple top-level queries or from different backing stores.

### Rules

- **One query, one store.** If two queries return the same data (or a subset), consolidate them. Use nested fields on the parent type instead of separate top-level queries. For example: `portfolio { positions, history, sectorExposure }` — not separate `positions`, `portfolioHistory`, and `sectorExposure` queries.
- **Grouping is a client concern.** Don't create `fooByTicker` variants of existing queries. If the client needs data grouped by ticker, it should group the flat result locally (`useMemo`). Server-side grouping duplicates the resolver logic and the archive scan.
- **One resolver per store.** If two resolvers read from the same store (e.g. `PortfolioSnapshotStore`), one should delegate to the other or both should be fields on the same parent type resolved by a single query.
- **Remove, don't deprecate.** When consolidating queries, delete the dead query from schema, server wiring, resolver, tests, frontend documents, hooks, and types. Dead surface area misleads consumers and accumulates stale tests.

### Before adding a new top-level query

1. Check if the data already lives on an existing type as a nested field.
2. Check if another query reads from the same backing store.
3. If either is true, add a field resolver on the existing parent type instead of a new root query.

### Yojin canonical query paths

| Data | Canonical path | Backing store |
|---|---|---|
| Portfolio snapshot | `portfolio` | PortfolioSnapshotStore |
| Positions | `portfolio.positions` | PortfolioSnapshotStore |
| Portfolio history | `portfolio.history` | PortfolioSnapshotStore |
| Sector exposure | `portfolio.sectorExposure` | PortfolioSnapshotStore (computed) |
| Signals | `signals` | SignalArchive |
| Signal groups | `signalGroups` | SignalGroupArchive |
| Curated signals | `curatedSignals` | CuratedSignalStore |
| Insight reports | `insightReports` / `latestInsightReport` | InsightStore |

## Live data: always fetch, never serve stale

Any resolver or mutation that returns price-sensitive data (currentPrice, marketValue, unrealizedPnl, totalValue, dayChange, sparkline) **must call `enrichWithLiveQuotes()`** before returning.

### Rules

- **Queries**: `portfolioQuery` already calls `enrichWithLiveQuotes`. Any new query returning `PortfolioSnapshot` must do the same.
- **Mutations**: Every mutation that returns `PortfolioSnapshot` (add, edit, remove, refresh) must call `enrichWithLiveQuotes()` on the saved snapshot before returning. Never return the raw `snapshotStore.save()` result — it has `costBasis` as `currentPrice`, zero PnL, and no `dayChange`.
- **Subscriptions**: `pubsub.publish('portfolioUpdate', ...)` must publish the enriched snapshot, not the raw saved one.
- **History trailing point**: `portfolioHistoryQuery` must live-price the most recent data point (today's entry) via `enrichWithLiveQuotes`. Historical points use stored values to preserve the time-series.
- **Fallback**: If Jintel is unavailable, `enrichWithLiveQuotes` returns the original snapshot unchanged (stored prices). This is acceptable — the data may be stale but it's the best available. Do NOT fabricate prices or use hardcoded stubs.
