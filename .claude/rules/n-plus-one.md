# N+1 Query Prevention

## Rule
Never issue one query per item when a single batch query can serve the same purpose. This applies to:
- Signal archive queries (use `tickers` array filter, not per-ticker loops)
- Jintel API calls (use `batchEnrich`, not per-ticker `enrich`)
- Any JSONL file scan or API call inside a `.map()` / `.forEach()` / `for` loop

## Pattern to avoid
```typescript
// BAD: N queries — reads all date files N times
for (const ticker of tickers) {
  const signals = await archive.query({ ticker, limit: 20 });
  results.set(ticker, signals);
}
```

## Correct pattern
```typescript
// GOOD: 1 query — reads date files once, groups in memory
const all = await archive.query({ tickers, limit: 20 * tickers.length });
const byTicker = groupByTicker(all);
```

## Pre-compute filter values
When filtering inside a hot loop (e.g. matching signals against a filter), hoist all allocations (Set, toLowerCase, date bound parsing) outside the loop. Never construct a `new Set()` or call `.toLowerCase()` per iteration.

## Where this matters most
- `src/signals/archive.ts` — `query()` scans every signal in date-range files
- `src/signals/tools.ts` — `grep_signals` serves agent tool calls
- `src/insights/data-gatherer.ts` — pre-aggregates data for all positions
- `src/api/graphql/resolvers/signals.ts` — GraphQL query resolver
- Any new code that touches `SignalArchive`, `InsightStore`, or `PortfolioSnapshotStore`
