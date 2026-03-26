# Overview Portfolio Value / P&L Audit

Date: 2026-03-26

This document is the current source-of-truth audit for how Yojin computes and displays:

- portfolio value
- total value history
- P&L
- position-level changes
- chart tooltips
- timeframe filtering

It covers Yojin frontend, Yojin backend, local snapshot storage, and the local `../Jintel` codebase.

## 1. Executive Summary

The overview page is broken for multiple independent reasons, not one.

1. The portfolio value card uses the latest snapshot repriced with live Jintel quotes, but the history chart mostly uses stored snapshot totals. These are different datasets by design.
2. The "today" change on the portfolio value card and connected accounts card is wrong because it sums `quote.change` per position without multiplying by quantity.
3. The P&L chart is not using `totalPnl`. It derives daily bars from `totalValue` deltas on the client, so it can disagree with both stored P&L and live P&L.
4. The P&L chart has a timezone/day-key bug that can shift bars by a day and zero out expected values.
5. Several portfolio mutations do not invalidate `portfolioHistory`, so the charts can stay stale while the portfolio card updates.
6. Your local history is extremely sparse: 8 raw snapshots collapse to 2 daily points after backend dedupe, so timeframe switching is mostly meaningless.
7. Your local snapshot data is missing cost basis for most positions, which makes stored P&L and total cost unreliable.
8. Jintel provides live quotes, but it does not currently expose historical price series through GraphQL, so real sparklines and time-series chart data are not coming from Jintel today.

## 2. Current Architecture

### Write side

There are 3 main ways positions enter snapshot history:

1. Manual add/edit/remove
2. Onboarding `confirmPositions`
3. Platform sync through `ConnectionManager`

All of them ultimately write to `~/.yojin/snapshots/portfolio.jsonl` through [`src/portfolio/snapshot-store.ts`](/Users/deanshaked/Desktop/Yojin/src/portfolio/snapshot-store.ts#L42).

### Read side

There are 3 important read paths:

1. `portfolioQuery()`
   Source: [`src/api/graphql/resolvers/portfolio.ts`](/Users/deanshaked/Desktop/Yojin/src/api/graphql/resolvers/portfolio.ts#L170)
   Behavior: latest snapshot + `enrichWithLiveQuotes()`

2. `positionsQuery()`
   Source: [`src/api/graphql/resolvers/portfolio.ts`](/Users/deanshaked/Desktop/Yojin/src/api/graphql/resolvers/portfolio.ts#L175)
   Behavior: latest snapshot + `enrichWithLiveQuotes()`, then return positions

3. `portfolioHistoryQuery()`
   Source: [`src/api/graphql/resolvers/portfolio.ts`](/Users/deanshaked/Desktop/Yojin/src/api/graphql/resolvers/portfolio.ts#L181)
   Behavior:
   - read all snapshots
   - sort by timestamp
   - keep only the latest snapshot per UTC day
   - return stored totals for those daily snapshots
   - append one extra live point if live repricing changes the latest day

That means the overview page is already mixing:

- stored historical totals
- live repriced current totals
- client-side derived daily deltas

## 3. Source Of Truth By Metric

| Metric | Current source | Live or stored | Notes |
| --- | --- | --- | --- |
| Portfolio Value card total | latest snapshot repriced by Jintel quotes | live | [`portfolioQuery()`](/Users/deanshaked/Desktop/Yojin/src/api/graphql/resolvers/portfolio.ts#L170) |
| Portfolio Value card "today" change | sum of `position.dayChange` | live but wrong units | per-share change is summed as if it were portfolio dollars |
| Positions table current price | Jintel quote price | live | correct source |
| Positions table change $ | `quote.change` | live per-share | fine only if intended as price change, not position-dollar change |
| Total Value chart | `portfolioHistory` | mostly stored, sometimes last live point | history is deduped to one point per day |
| P&L chart | client-side delta of `history.totalValue` | derived | not using `totalPnl` |
| Snapshot `totalPnl` | stored at save-time | stored | depends on ingestion quality and stored `unrealizedPnl` |
| Snapshot `totalCost` | stored at save-time | stored | different formula than live resolver |

## 4. Exact Formulas In Use

### 4.1 Stored snapshot totals

Snapshot save logic:
[`src/portfolio/snapshot-store.ts`](/Users/deanshaked/Desktop/Yojin/src/portfolio/snapshot-store.ts#L54)

```ts
totalValue = sum(position.marketValue)
totalPnl = sum(position.unrealizedPnl)
totalCost = totalValue - totalPnl
```

This is an inverse derivation of total cost.

### 4.2 Live totals

Live enrichment logic:
[`src/api/graphql/resolvers/portfolio.ts`](/Users/deanshaked/Desktop/Yojin/src/api/graphql/resolvers/portfolio.ts#L127)

```ts
totalValue = sum(position.marketValue)
totalCost = sum(position.costBasis * position.quantity)
totalPnl = totalValue - totalCost
```

This is a direct derivation of total cost.

These two formulas are not equivalent when:

- cost basis is missing or zero
- stored `unrealizedPnl` is stale
- a connector provides inconsistent semantics

### 4.3 Portfolio Value card daily change

[`apps/web/src/components/overview/portfolio-value-card.tsx`](/Users/deanshaked/Desktop/Yojin/apps/web/src/components/overview/portfolio-value-card.tsx#L65)

```ts
change = sum(position.dayChange ?? 0)
```

But `position.dayChange` comes from:

[`src/api/graphql/resolvers/portfolio.ts`](/Users/deanshaked/Desktop/Yojin/src/api/graphql/resolvers/portfolio.ts#L119)

```ts
dayChange = quote.change
```

And Jintel defines `quote.change` as price change per unit/share:

- equities: `price - previousClose`
- crypto: reconstructed from 24h percent and current price

Source:
[`../Jintel/src/graphql/resolvers.ts`](/Users/deanshaked/Desktop/Jintel/src/graphql/resolvers.ts#L418)
[`../Jintel/src/graphql/resolvers.ts`](/Users/deanshaked/Desktop/Jintel/src/graphql/resolvers.ts#L705)

So the overview card is using per-share delta as if it were total position delta. It should be:

```ts
positionDollarChange = quote.change * quantity
```

## 5. Frontend Component Behavior

### 5.1 Portfolio Value card

Source:
[`apps/web/src/components/overview/portfolio-value-card.tsx`](/Users/deanshaked/Desktop/Yojin/apps/web/src/components/overview/portfolio-value-card.tsx)

What it shows:

- `totalValue` from live-repriced `portfolio`
- `today` change from broken per-share aggregation

### 5.2 Portfolio overview wrapper

Source:
[`apps/web/src/components/portfolio/portfolio-overview.tsx`](/Users/deanshaked/Desktop/Yojin/apps/web/src/components/portfolio/portfolio-overview.tsx)

It fetches `portfolioHistory` once and passes it to `PerformanceOvertime`, but `TotalValueGraph` refetches the same query independently instead of receiving the already-loaded `history` prop.

That is not the main bug, but it creates:

- duplicated loading/error logic
- avoidable divergence between the two charts

### 5.3 Total Value chart

Source:
[`apps/web/src/components/portfolio/total-value-graph.tsx`](/Users/deanshaked/Desktop/Yojin/apps/web/src/components/portfolio/total-value-graph.tsx)

What it does:

1. fetches `portfolioHistory`
2. filters client-side by timeframe
3. maps each point to `{ date: "Mar 26", value }`
4. pads to 2 points when only 1 exists

Tooltip issues:

1. If only one point exists, `ensureMinPoints()` inserts a synthetic point with `date: ''`, so tooltip label can be blank.
2. If the backend appends a live point on the same day as the last stored snapshot, both points map to the same `"Mar 26"` label because time is discarded.
3. Tooltip shows only a date label, not an actual timestamp, so stored-vs-live same-day points are indistinguishable.

### 5.4 P&L chart

Source:
[`apps/web/src/components/portfolio/performance-overtime.tsx`](/Users/deanshaked/Desktop/Yojin/apps/web/src/components/portfolio/performance-overtime.tsx)

What it actually measures:

- day-over-day change in `totalValue`
- not stored `totalPnl`
- not live `totalPnl`

This means:

- deposits or new positions look like P&L
- edits/removals can look like P&L
- missing snapshots flatten the chart

## 6. Confirmed Bugs

### Bug 1. Portfolio "today" change is wrong

Files:

- [`apps/web/src/components/overview/portfolio-value-card.tsx`](/Users/deanshaked/Desktop/Yojin/apps/web/src/components/overview/portfolio-value-card.tsx#L65)
- [`apps/web/src/components/overview/connected-accounts-card.tsx`](/Users/deanshaked/Desktop/Yojin/apps/web/src/components/overview/connected-accounts-card.tsx#L44)
- [`src/api/graphql/resolvers/portfolio.ts`](/Users/deanshaked/Desktop/Yojin/src/api/graphql/resolvers/portfolio.ts#L119)

Root cause:

- `dayChange` is per-share
- frontend sums it as if it were total position dollars

Owner: Yojin frontend/backend contract

### Bug 2. Charts can stay stale after portfolio changes

File:
[`apps/web/src/lib/graphql.ts`](/Users/deanshaked/Desktop/Yojin/apps/web/src/lib/graphql.ts#L40)

`portfolioHistory` is invalidated for:

- `confirmPositions`
- `completeOnboarding`
- `clearAppData`

But not invalidated for:

- `refreshPositions`
- `addManualPosition`
- `editPosition`
- `removePosition`

That means the portfolio card can update while the charts keep old history.

Owner: Yojin frontend

### Bug 3. P&L chart has a timezone/day-key bug

File:
[`apps/web/src/components/portfolio/performance-overtime.tsx`](/Users/deanshaked/Desktop/Yojin/apps/web/src/components/portfolio/performance-overtime.tsx#L60)

The code:

- stores history keys as `timestamp.slice(0, 10)` from UTC timestamps
- then walks days using local `Date`
- then converts the cursor back with `toISOString().slice(0, 10)`

That mixes local calendar dates with UTC day keys.

Impact:

- bars can shift by a day
- a real change can appear as zero
- label and data lookup can disagree

In a positive-offset timezone, the chart can display `Mar 26` while looking up `2026-03-25`.

Owner: Yojin frontend

### Bug 4. P&L chart is conceptually not a P&L chart

File:
[`apps/web/src/components/portfolio/performance-overtime.tsx`](/Users/deanshaked/Desktop/Yojin/apps/web/src/components/portfolio/performance-overtime.tsx#L44)

The bars are:

```ts
todayTotalValue - previousKnownTotalValue
```

This is portfolio value movement, not true P&L. It treats:

- new deposits
- imported holdings
- manual edits
- removed positions

as if they were profit/loss.

Owner: Yojin product/data model

### Bug 5. Stored totals and live totals use different cost formulas

Files:

- [`src/portfolio/snapshot-store.ts`](/Users/deanshaked/Desktop/Yojin/src/portfolio/snapshot-store.ts#L54)
- [`src/api/graphql/resolvers/portfolio.ts`](/Users/deanshaked/Desktop/Yojin/src/api/graphql/resolvers/portfolio.ts#L127)

Impact:

- history can disagree with current totals even when data quality is good
- discrepancies get worse when cost basis is missing

Owner: Yojin backend

### Bug 6. Missing cost basis makes stored P&L mostly unusable

Files:

- [`src/api/graphql/resolvers/onboarding.ts`](/Users/deanshaked/Desktop/Yojin/src/api/graphql/resolvers/onboarding.ts#L18)
- [`src/scraper/connection-manager.ts`](/Users/deanshaked/Desktop/Yojin/src/scraper/connection-manager.ts#L12)

Observed local data:

- latest snapshot timestamp: `2026-03-26T09:13:48.431Z`
- total positions: `36`
- zero cost basis positions: `33`
- zero cost basis share: `91.67%`

When onboarding confirmation is missing `avgEntry`, it stores:

```ts
costBasis: 0
unrealizedPnl: 0
```

When connection-manager sync is missing `costBasis`, it stores:

```ts
costBasis: currentPrice
```

Those two fallback behaviors are inconsistent. Both suppress useful P&L history.

Owner: Yojin ingestion

### Bug 7. History is too sparse for meaningful timeframes

Local file:
`~/.yojin/snapshots/portfolio.jsonl`

Observed local history:

- raw snapshots: `8`
- daily points after backend dedupe: `2`
- kept days:
  - `2026-03-25` totalValue `63158.79`
  - `2026-03-26` totalValue `74422.79`

Because the backend keeps only the last snapshot per UTC day, all timeframes currently collapse to almost the same picture.

Also, there is no automatic daily snapshot job. The scheduler only runs insights, not snapshot capture:

- [`src/scheduler.ts`](/Users/deanshaked/Desktop/Yojin/src/scheduler.ts)

Owner: Yojin backend/product

### Bug 8. Total Value tooltip has edge cases

File:
[`apps/web/src/components/portfolio/total-value-graph.tsx`](/Users/deanshaked/Desktop/Yojin/apps/web/src/components/portfolio/total-value-graph.tsx#L46)

Confirmed issues:

1. single-point history creates a blank-label synthetic point
2. same-day stored/live points collapse to the same label
3. tooltip has no timestamp precision, so "which point am I hovering?" is unclear

Owner: Yojin frontend

### Bug 9. Jintel historical market data is not wired into GraphQL

Files:

- [`../Jintel/src/graphql/resolvers.ts`](/Users/deanshaked/Desktop/Jintel/src/graphql/resolvers.ts#L686)
- [`../Jintel/src/connectors/technicals/technicals.ts`](/Users/deanshaked/Desktop/Jintel/src/connectors/technicals/technicals.ts#L82)

Facts:

- Jintel GraphQL `MarketData.history(range)` currently returns `[]`
- Jintel does have internal candle-fetch capability through the technicals connector and opentypebb/Yahoo Finance

Meaning:

- real historical series are possible in Jintel
- but they are not exposed on the GraphQL contract Yojin is using

Owner: Jintel backend to expose, Yojin frontend/backend to consume

### Bug 10. Polymarket cost basis semantics look wrong

File:
[`src/scraper/platforms/polymarket/api-connector.ts`](/Users/deanshaked/Desktop/Yojin/src/scraper/platforms/polymarket/api-connector.ts#L1)

Current mapping:

```ts
quantity = p.size
costBasis = p.avg_price * p.size
```

But everywhere else in Yojin, `costBasis` means per-unit basis, not total spent.

If this connector is used, later formulas like `costBasis * quantity` can double-count size.

Owner: Yojin ingestion

## 7. What Is Missing And Who Owns It

| Data | Needed for | Exists in Jintel today | Exists in Yojin today | Owner |
| --- | --- | --- | --- | --- |
| Live quote price | current value | yes | yes | Jintel provides, Yojin consumes |
| Per-position day dollar change | correct portfolio/day cards | not directly, but derivable from `change * quantity` | no | Yojin |
| Historical portfolio snapshots | value/P&L charts | no | yes, but sparse | Yojin |
| Real price history / candles | real sparklines and richer charts | internally yes, GraphQL no | no | Jintel first, then Yojin |
| Cost basis | real P&L | no | partially, often missing | Yojin ingestion |
| Realized P&L | true portfolio performance | no | no | Yojin |
| Cash flows / deposits / withdrawals | true net performance | no | no | Yojin |
| Dividend history | total return | no | no | Yojin or broker integrations |

## 8. Local Data Quality Notes

Your local snapshots are not just sparse. They also contain suspicious data-quality issues:

1. 33 of 36 latest positions have `costBasis = 0`
2. the same crypto-like symbol set appears across multiple platforms
3. the `INTERACTIVE_BROKERS` positions in the latest snapshot are marked as `assetClass: EQUITY` while containing crypto-like symbols such as `ETH`, `BNB`, `ARB`

That does not prove the code is wrong by itself, but it means the local snapshot file should not be treated as a clean financial ledger.

## 9. Why Your Reported Symptoms Happen

### "Numbers are not correlated with the portfolio value"

True, because:

- the value card shows live repriced totals
- the chart mostly shows stored daily totals
- the daily change card is using the wrong units
- the P&L chart is charting value deltas, not true P&L

### "The chart doesn't change when switching time frames"

Mostly true, because:

- local history only has 2 daily points
- different windows still include the same 2 days
- stale `portfolioHistory` cache can also freeze charts after mutations

### "The P&L chart is suddenly not showing"

Possible causes in the current code:

1. history has fewer than 2 points
2. timezone/day-key mismatch collapses expected bars
3. the chart generates only zero bars and tooltip hides zeros

### "When it shows, the tooltips don't reflect reality"

True, because:

- P&L labels can shift by timezone
- P&L bars are not true P&L in the first place
- Total Value tooltip can show blank or duplicate-date labels

## 10. Recommended Fix Order

If the goal is to stabilize the overview page fast, fix in this order:

1. Fix cache invalidation for `portfolioHistory` after `refreshPositions`, `addManualPosition`, `editPosition`, and `removePosition`.
2. Fix daily change units: use `quote.change * quantity`.
3. Fix the P&L day-key logic so it uses one consistent timezone/day representation.
4. Decide what the P&L chart should mean:
   - true unrealized P&L
   - day-over-day portfolio value delta
   - net-of-cash-flow performance
5. Unify cost-basis semantics across all ingestion paths.
6. Capture more history automatically with scheduled snapshot saves.
7. Expose real historical candles from Jintel if you want real sparklines or richer timeframes.

## 11. Bottom Line

This is not a single charting bug. The current overview combines:

- inconsistent write-side data
- mixed live vs stored semantics
- wrong unit conversions
- stale cache behavior
- sparse history
- timezone mistakes

Until those are normalized, the overview page will keep drifting out of sync even if individual chart components are patched.
