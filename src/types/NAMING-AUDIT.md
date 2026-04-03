# Ticker vs Symbol Naming Audit

Audit date: 2026-04-03

## Summary

The codebase uses both `ticker` and `symbol` to refer to the same concept: a trading asset identifier (e.g. "AAPL", "BTC-USD"). The inconsistency exists because two naming conventions collided:

- **`ticker`** — used by the Jintel client API (external dependency), the signals domain, and the curation pipeline
- **`symbol`** — used by the GraphQL schema (user-facing), portfolio domain, insights, snap, watchlist, and scraper

The split is not random. It follows domain boundaries, but the boundary is leaky: resolver mappers translate between them, and some modules (like `profile-bridge.ts`) bridge both worlds.

## Convention by Module

| Module | Convention | Schema/Type File | Serialized to Disk? | Notes |
|--------|-----------|-----------------|---------------------|-------|
| `@yojinhq/jintel-client` | `ticker` | `types.d.ts` | N/A (external API) | MarketQuote.ticker, Entity.tickers, TickerPriceHistory.ticker |
| `src/signals/types.ts` | `ticker` | AssetSchema, SignalAssetLinkSchema, PortfolioRelevanceScoreSchema | Yes (JSONL) | Core signal data model |
| `src/signals/curation/assessment-types.ts` | `ticker` | SignalAssessmentSchema | Yes (JSONL) | Per-signal assessment |
| `src/signals/curation/assessment-tools.ts` | `ticker` | Tool param schema | No | Agent tool definition |
| `src/signals/tools.ts` | `ticker` | Tool param schema | No | Agent tool definition |
| `src/signals/archive.ts` | `ticker` | Query filter interface | No | `SignalQueryFilter.ticker` |
| `src/profiles/types.ts` | `ticker` | TickerProfileEntrySchema | Yes (JSONL) | Per-ticker knowledge |
| `src/profiles/profile-store.ts` | `ticker` | Method params | No | `getForTicker(ticker)` |
| `src/memory/types.ts` | `ticker` | PriceProvider param | No | Function signature |
| `src/skills/types.ts` | `ticker` | Condition params | No | `{ ticker: 'AAPL', threshold }` |
| `src/jintel/tools.ts` | `ticker` | Tool param schemas | No | All Jintel agent tools |
| `src/jintel/signal-fetcher.ts` | `ticker` | Internal functions | No | Bridges Jintel to signals |
| `src/jintel/price-provider.ts` | `ticker` | Function param | No | Wraps Jintel quotes API |
| `src/api/graphql/types.ts` | `symbol` | Position, Quote, AlertRule, PriceEvent, ManualPositionInput | No (in-memory GQL) | GraphQL domain types |
| `src/api/graphql/schema.ts` | **mixed** | SDL | No | See breakdown below |
| `src/insights/types.ts` | `symbol` | PositionInsightSchema | Yes (JSONL) | Per-position insight |
| `src/insights/micro-types.ts` | `symbol` | MicroInsightSchema | Yes (JSONL) | Per-asset micro research |
| `src/insights/data-gatherer.ts` | `symbol` | DataBrief interface | No (in-memory) | Position data aggregation |
| `src/insights/micro-runner.ts` | **mixed** | Function params | No | Takes `symbol`, aliases to `ticker` internally |
| `src/snap/types.ts` | `symbol` | AssetSnapSchema | Yes (JSONL) | Snap asset briefs |
| `src/watchlist/types.ts` | `symbol` | WatchlistEntrySchema | Yes (JSON) | Watchlist entries |
| `src/scraper/types.ts` | `symbol` | ExtractedPositionSchema | No (transient) | Scraper output |
| `src/guards/types.ts` | `symbol` | Guard check schema | No | `symbol` field in guard context |
| `src/trust/pii/types.ts` | `symbol` | Redacted position schema | No | PII redaction shapes |
| `src/portfolio/snapshot-store.ts` | `symbol` | (uses Position from GQL types) | Yes (JSONL) | Stores positions with `symbol` |
| `apps/web/src/api/types.ts` | **mixed** | Client GQL types | No | Mirrors schema: `symbol` for portfolio, `ticker` for signals/profiles |

## GraphQL Schema Breakdown

The schema itself is mixed:

### Uses `symbol`
- `Position.symbol`
- `Quote.symbol`
- `WatchlistEntry.symbol`
- `MicroInsight.symbol`
- `PositionInsight.symbol`
- `AssetSnap.symbol`
- `ManualPositionInput.symbol`
- `AlertRule.symbol`
- `PriceEvent.symbol`
- Query args: `quote(symbol)`, `news(symbol)`, `microInsight(symbol)`, `editPosition(symbol)`, `removePosition(symbol)`, `addToWatchlist(symbol)`, `removeFromWatchlist(symbol)`

### Uses `ticker`
- `TickerPriceHistory.ticker`
- `TickerProfileEntry.ticker`
- `TickerProfile.ticker`
- `PortfolioRelevanceScore.ticker`
- `ActivityEvent.ticker`
- `SignalAssessment.ticker` (in AssessmentReport)
- Query args: `signals(ticker)`, `signalGroups(ticker)`, `curatedSignals(ticker)`, `signalAssessments(ticker)`, `tickerProfile(ticker)`

### Pattern
- **Portfolio/user-facing domain**: `symbol`
- **Signal/assessment/profile domain**: `ticker`
- **Jintel-originated types**: `ticker` (pass-through from external API)

## Translation Points (Resolver Mappers)

These are the exact locations where `ticker` is translated to `symbol` or vice versa:

### `src/api/graphql/resolvers/market.ts:117`
```typescript
symbol: q.ticker,  // MarketQuote.ticker → Quote.symbol
```
Translates Jintel `MarketQuote.ticker` to GQL `Quote.symbol`.

### `src/api/graphql/resolvers/signals.ts:75`
```typescript
tickers: signal.assets.map((a) => a.ticker),  // SignalAssetLink.ticker → Signal.tickers[]
```
Maps signal asset links (which use `ticker`) to the GQL `Signal.tickers` array field (plural, not renamed).

### `src/api/graphql/resolvers/portfolio.ts:131,191`
```typescript
const symbols = [...new Set(snapshot.positions.map((p) => p.symbol))];
// ...
const quoteMap = new Map<string, MarketQuote>(validQuotes.map((q) => [q.ticker, q]));
// ...
const quote = quoteMap.get(pos.symbol);  // symbol used as key into ticker-keyed map
```
The portfolio resolver bridges between Position.symbol and MarketQuote.ticker by building a map keyed on `ticker` and looking up by `symbol`. This works because both contain the same string value.

### `src/profiles/profile-bridge.ts:41,99`
```typescript
ticker: position.symbol,  // PositionInsight.symbol → TickerProfileEntry.ticker
```
Bridges insights domain (uses `symbol`) to profiles domain (uses `ticker`).

### `src/scraper/platforms/ibkr/api-connector.ts:100`
```typescript
symbol: pos.ticker ?? pos.contractDesc,  // IB API ticker → ExtractedPosition.symbol
```
Translates IBKR's external API `ticker` field to the internal `symbol` field.

### `src/insights/micro-runner.ts:57`
```typescript
const ticker = symbol.toUpperCase();  // Function param is `symbol`, local alias is `ticker`
```
The function signature uses `symbol` but immediately aliases to `ticker` for internal use. All log messages and Jintel calls use the `ticker` alias.

## Safe Renames (Non-Breaking)

These changes would NOT break external APIs, GraphQL schema, or serialized JSONL data:

| Change | Location | Risk | Rationale |
|--------|----------|------|-----------|
| Rename local `ticker` alias to `symbol` | `src/insights/micro-runner.ts:57` | None | Local variable only, no serialization |
| Rename `ticker` param in `buildLessonEntry` | `src/profiles/profile-bridge.ts:124` | None | Internal function param |
| Rename `ticker` param in `PriceProvider` type | `src/memory/types.ts:69` | Very low | Internal type, only used by `jintel/price-provider.ts` |
| Add `@deprecated` JSDoc to translation points | Various resolvers | None | Documentation only |

## Breaking Renames (DO NOT DO)

These would break serialized data, external APIs, or require coordinated changes:

| Change | Why Breaking |
|--------|-------------|
| Rename `AssetSchema.ticker` to `symbol` | Breaks all JSONL signal archives on disk |
| Rename `SignalAssetLinkSchema.ticker` | Breaks signal JSONL archives |
| Rename `PortfolioRelevanceScoreSchema.ticker` | Breaks relevance score archives |
| Rename `SignalAssessmentSchema.ticker` | Breaks assessment JSONL archives |
| Rename `TickerProfileEntrySchema.ticker` | Breaks per-ticker profile JSONL files |
| Change `TickerPriceHistory.ticker` in GQL schema | Breaks frontend types + queries |
| Change `PortfolioRelevanceScore.ticker` in GQL schema | Breaks frontend intel-feed component |
| Change any `@yojinhq/jintel-client` types | External package, not owned by this repo |

## Recommended Migration Path

### Phase 1: Document (this file) — DONE
Catalog the inconsistency and its boundaries.

### Phase 2: Standardize Internal-Only Code (low effort, safe)
- Rename local variable aliases where `symbol` is received but aliased to `ticker` (micro-runner.ts)
- Use consistent param names in internal helper functions

### Phase 3: Add Zod Transform Layer (medium effort)
If full standardization is desired, add `.transform()` calls in Zod schemas that read JSONL, so the on-disk format stays `ticker` but the in-memory type uses `symbol`. This requires:
1. Define new schemas with `symbol` + `.transform()` for backward compat
2. Update all consumers to use the new field name
3. Write migration utility for on-disk data (optional — transform handles reads)

### Phase 4: Schema Unification (high effort, breaking)
Rename `ticker` fields in the GraphQL schema to `symbol`. Requires:
1. Schema SDL changes
2. Resolver type interface changes
3. Frontend type changes (apps/web/src/api/types.ts)
4. Frontend component changes (~15 components reference `.ticker`)
5. Cache key registration updates
6. Coordinated deploy of backend + frontend

### Recommendation
**Do not pursue Phase 3 or 4 now.** The current split is stable and follows clear domain boundaries. The translation points are few (5 locations) and well-documented above. The cost of a full migration outweighs the benefit given that:
- The Jintel client will always use `ticker` (external API)
- Signal JSONL archives would need migration or dual-read support
- The GraphQL schema already has both conventions baked into clients

### Estimated Effort

| Phase | Effort | Risk |
|-------|--------|------|
| Phase 1 (document) | 1 hour | None |
| Phase 2 (internal aliases) | 1-2 hours | Very low |
| Phase 3 (Zod transforms) | 1-2 days | Medium (subtle bugs in transform chains) |
| Phase 4 (full unification) | 3-5 days | High (breaking change, coordinated deploy) |
