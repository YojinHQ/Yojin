# Portfolio, Total Value & PnL — Complete Data Analysis

> Investigation of how portfolio value, PnL, charts, and time frames work across
> the Yojin frontend, Yojin backend, and Jintel API. Covers every layer, every
> bug, and every data gap.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Data Flow Diagram](#2-data-flow-diagram)
3. [Snapshot Store (Source of Truth)](#3-snapshot-store-source-of-truth)
4. [Live Quote Enrichment](#4-live-quote-enrichment)
5. [PnL Calculations](#5-pnl-calculations)
6. [Portfolio History (Time Series)](#6-portfolio-history-time-series)
7. [Frontend Components](#7-frontend-components)
8. [Jintel API — What It Provides vs. What We Need](#8-jintel-api--what-it-provides-vs-what-we-need)
9. [Current Snapshot Data (Your Actual Data)](#9-current-snapshot-data-your-actual-data)
10. [Confirmed Bugs](#10-confirmed-bugs)
11. [Architectural Issues](#11-architectural-issues)
12. [Fix Recommendations](#12-fix-recommendations)

---

## 1. Architecture Overview

```
┌────────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│    User Actions     │     │   Jintel API      │     │  Brokerage Scraper  │
│ (manual add/edit)   │     │ (live quotes)     │     │  (Playwright)       │
└────────┬───────────┘     └────────┬──────────┘     └──────────┬──────────┘
         │                          │                            │
         ▼                          │                            ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                     GraphQL Mutations / ConnectionManager                │
│   addManualPosition / editPosition / removePosition / syncPlatform      │
└────────────────────────────┬─────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    PortfolioSnapshotStore.save()                         │
│   Merge positions by platform → recompute totals → append JSONL line    │
│   File: ~/.yojin/snapshots/portfolio.jsonl                              │
└────────────────────────────┬─────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                     GraphQL Query Resolvers                              │
│                                                                          │
│   portfolioQuery()       → getLatest() + enrichWithLiveQuotes()         │
│   positionsQuery()       → getLatest() + enrichWithLiveQuotes()         │
│   portfolioHistoryQuery()→ getAll() + dedup by day + 1 live trailing pt │
│   enrichedSnapshotQuery()→ getLatest() + live quotes + fundamentals     │
└────────────────────────────┬─────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         React Frontend (urql)                            │
│                                                                          │
│   usePortfolio()        → PortfolioValueCard (total + daily change)     │
│   usePositions()        → PositionsPreview (top 5 + sparklines)         │
│   usePortfolioHistory() → PortfolioOverview                             │
│                              ├── TotalValueGraph (area chart)           │
│                              └── PerformanceOvertime (PnL bar chart)    │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Data Flow Diagram

### Write Path (how snapshots get created)

```
Manual Add Position
    → addManualPositionMutation()
    → Builds Position with currentPrice = costBasis, unrealizedPnl = 0
    → snapshotStore.save({ positions, platform, existingSnapshot })
    → Merge: keep other-platform positions + replace same-platform positions
    → Recompute: totalValue = sum(marketValue), totalPnl = sum(unrealizedPnl)
    → totalCost = totalValue - totalPnl  ← NOTE: derived inversely
    → Append JSON line to portfolio.jsonl
```

### Read Path (how data reaches the charts)

```
portfolioHistoryQuery()
    → snapshotStore.getAll()           // reads ENTIRE JSONL file
    → Sort by timestamp
    → Dedup to 1 per day (latest wins)
    → Map to { timestamp, totalValue, totalCost, totalPnl, totalPnlPercent }
    → enrichWithLiveQuotes(latest)     // one Jintel batch call
    → If live totalValue differs: push trailing "now" point
    → Return full array (NO time-range filtering)

Frontend: TotalValueGraph
    → usePortfolioHistory()            // fetches ALL history
    → useMemo: filter by scale (7D/1M/3M/YTD) client-side
    → Map to { date: "Mar 26", value: totalValue }
    → Render AreaChart

Frontend: PerformanceOvertime
    → Receives history[] as prop from PortfolioOverview
    → derivePnlFromHistory():
        → Build Map<dateKey, totalValue>
        → Walk every calendar day from cutoff to latest
        → For each day with snapshot: pnl = value - prevValue
        → Days without snapshot: pnl = 0
    → Render BarChart (green/red bars)
```

---

## 3. Snapshot Store (Source of Truth)

**File:** `src/portfolio/snapshot-store.ts`
**Data file:** `~/.yojin/snapshots/portfolio.jsonl`

### Snapshot Shape

```typescript
interface PortfolioSnapshot {
  id: string;                    // "snap-<8 char uuid>"
  positions: Position[];
  totalValue: number;            // sum(position.marketValue)
  totalCost: number;             // totalValue - totalPnl  ← INVERSE derivation
  totalPnl: number;              // sum(position.unrealizedPnl)
  totalPnlPercent: number;       // (totalPnl / totalCost) * 100
  timestamp: string;             // ISO-8601 at save time
  platform: string | null;       // always null for merged snapshots
}
```

### Position Shape

```typescript
interface Position {
  symbol: string;
  name: string;
  quantity: number;
  costBasis: number;             // user-provided or scraper-captured
  currentPrice: number;          // at save time = costBasis (for manual adds)
  marketValue: number;           // quantity * currentPrice
  unrealizedPnl: number;         // marketValue - (costBasis * quantity)
  unrealizedPnlPercent: number;  // ((currentPrice - costBasis) / costBasis) * 100
  assetClass: AssetClass;
  platform: string;
  // Optional (only present after live enrichment):
  dayChange?: number;            // Jintel quote.change (PER-SHARE!)
  dayChangePercent?: number;     // Jintel quote.changePercent
  sparkline?: number[];          // synthetic ~20 points from OHLC
}
```

### How `save()` Works

1. Takes positions for ONE platform
2. Reads existing latest snapshot (or uses provided `existingSnapshot`)
3. Filters out all existing positions for the incoming platform
4. Merges: `[...otherPlatformPositions, ...incomingPositions]`
5. Recomputes totals:
   - `totalValue = sum(pos.marketValue)`
   - `totalPnl = sum(pos.unrealizedPnl)`
   - `totalCost = totalValue - totalPnl` (inverse derivation)
6. Appends as new JSON line

### Key Property

Every `save()` call creates a new JSONL line. Multiple saves on the same day = multiple lines (later deduped to 1 in `portfolioHistoryQuery`).

---

## 4. Live Quote Enrichment

**File:** `src/api/graphql/resolvers/portfolio.ts` → `enrichWithLiveQuotes()`

Called on every `portfolio`, `positions`, and `enrichedSnapshot` query. NOT called for `portfolioHistory` (history uses stored values, except for the trailing live point).

### What It Does

1. Collects unique symbols from all positions
2. **One batch call**: `jintelClient.quotes(symbols)` (no N+1)
3. For each position with a matching quote:
   ```
   currentPrice = quote.price
   marketValue = quantity * currentPrice
   dayChange = quote.change           ← BUG: this is per-share, not per-position
   dayChangePercent = quote.changePercent
   unrealizedPnl = marketValue - (costBasis * quantity)   // only if costBasis > 0
   unrealizedPnlPercent = ((currentPrice - costBasis) / costBasis) * 100
   sparkline = buildSyntheticSparkline(quote)
   ```
4. Recomputes portfolio totals:
   ```
   totalValue = sum(pos.marketValue)
   totalCost = sum(pos.costBasis * pos.quantity)    ← NOTE: different formula than save()!
   totalPnl = totalValue - totalCost
   totalPnlPercent = (totalPnl / totalCost) * 100
   ```
5. Returns a new snapshot (original not mutated)
6. Falls back to original snapshot if Jintel unavailable

---

## 5. PnL Calculations

### There are THREE different PnL computations

| What | Where | Formula | Used By |
|------|-------|---------|---------|
| **Stored PnL** | `snapshot-store.ts:55-56` | `totalPnl = sum(pos.unrealizedPnl)` ; `totalCost = totalValue - totalPnl` | History chart (stored values) |
| **Live PnL** | `portfolio.ts:128-131` | `totalCost = sum(costBasis * qty)` ; `totalPnl = totalValue - totalCost` | Portfolio card, positions list |
| **Daily P&L bars** | `performance-overtime.tsx:44-92` | `pnl = todayTotalValue - yesterdayTotalValue` | P&L bar chart |

### The `totalCost` Formula Mismatch

**Stored** (in `snapshot-store.ts`):
```typescript
totalCost = totalValue - totalPnl
// Where totalPnl = sum(position.unrealizedPnl)
```

**Live** (in `enrichWithLiveQuotes`):
```typescript
totalCost = sum(position.costBasis * position.quantity)
```

These **will produce different values** when rounding is involved or when positions have `costBasis = 0` (unrealizedPnl forced to 0).

### Position-Level PnL

```typescript
// At save time (manual add):
unrealizedPnl = 0                     // because currentPrice = costBasis
unrealizedPnlPercent = 0

// At query time (live enrichment):
unrealizedPnl = (livePrice - costBasis) * quantity    // if costBasis > 0
unrealizedPnlPercent = ((livePrice - costBasis) / costBasis) * 100
```

### Daily Change Computation (Portfolio Value Card)

Frontend (`portfolio-value-card.tsx:66-67`):
```typescript
const change = positionList.reduce((sum, p) => sum + (p.dayChange ?? 0), 0);
const dayChangePercent = totalValue > 0
  ? Math.round((change / (totalValue - change)) * 10000) / 100
  : 0;
```

Where `p.dayChange` = `quote.change` from Jintel = **price - previousClose** (per-share dollar amount).

---

## 6. Portfolio History (Time Series)

**Resolver:** `portfolioHistoryQuery()` in `portfolio.ts:181-225`

### Algorithm

1. `snapshotStore.getAll()` — reads every JSONL line (no pagination)
2. Sort by timestamp ascending
3. Dedup to 1 snapshot per day: `Map<YYYY-MM-DD, PortfolioSnapshot>` (last snapshot per day wins)
4. Map to `PortfolioHistoryPoint`:
   ```typescript
   { timestamp, totalValue, totalCost, totalPnl, totalPnlPercent }
   ```
   Uses **stored** values (not re-priced). Historical fidelity preserved.
5. Append live trailing point if live `totalValue` differs from last stored.

### What `PortfolioHistoryPoint` Contains

```typescript
interface PortfolioHistoryPoint {
  timestamp: string;
  totalValue: number;
  totalCost: number;
  totalPnl: number;
  totalPnlPercent: number;
}
```

### Time-Range Filtering

**Server-side:** NONE. The GraphQL query accepts no variables. All history is returned.

**Client-side:** Both `TotalValueGraph` and `PerformanceOvertime` filter by `TimeScale`:

```typescript
const SCALE_DAYS = { '7D': 7, '1M': 30, '3M': 90, YTD: <calculated> };
const cutoff = latestTimestamp - scaleDays * 86400000;
const filtered = history.filter(p => p.timestamp >= cutoff);
```

---

## 7. Frontend Components

### 7.1 PortfolioValueCard (`overview/portfolio-value-card.tsx`)

**Query:** `usePortfolio()` → `PORTFOLIO_QUERY` → `enrichWithLiveQuotes(snapshot)`

**Displays:**
- `totalValue` (large number)
- Daily change: `sum(pos.dayChange)` across all positions
- Daily change %: `change / (totalValue - change) * 100`
- "today" label

**No chart. No time frame switching.**

### 7.2 PortfolioOverview (`portfolio/portfolio-overview.tsx`)

**Query:** `usePortfolioHistory()` → `PORTFOLIO_HISTORY_QUERY`

**Role:** Parent orchestrator. Owns `scale` state (`7D | 1M | 3M | YTD`) and renders time-scale buttons.

**Children:**
- `TotalValueGraph` — gets `scale` as prop, fetches its OWN `usePortfolioHistory()` (redundant)
- `PerformanceOvertime` — gets `scale` and `history[]` as props from parent

### 7.3 TotalValueGraph (`portfolio/total-value-graph.tsx`)

**Query:** Its OWN `usePortfolioHistory()` (separate from parent's). Same data due to urql cache dedup.

**Process:**
1. Filter history by scale → cutoff
2. Map to `{ date: "Mar 26", value: totalValue }`
3. `ensureMinPoints()`: if only 1 point, pad with synthetic earlier point
4. Y-axis domain: min/max with 10% padding
5. ReferenceLine at baseline (first point's value)

**Tooltip:** Shows `"Mar 26 · $124,850.32"` — date from XAxis `label` + formatted value.

### 7.4 PerformanceOvertime (`portfolio/performance-overtime.tsx`)

**Query:** None. Receives `history[]` from parent.

**Process (`derivePnlFromHistory`):**
1. Return `[]` if fewer than 2 history points
2. Build `valueByDay: Map<YYYY-MM-DD, totalValue>` from history
3. Find baseline `prevValue`: last snapshot at or before cutoff
4. Walk every calendar day from cutoff to latest:
   - Day with snapshot: `pnl = value - prevValue` → update prevValue
   - Day without snapshot: `pnl = 0` (transparent bar)
5. Return `PnlDataPoint[]`

**Tooltip:** Shows nothing for `pnl = 0` bars. Shows `"Mar 26 · +$1,234"` for non-zero.

### 7.5 PositionsPreview (`overview/positions-preview.tsx`)

**Query:** `usePositions()` → `POSITIONS_QUERY`

**Sparklines:** Synthetic ~20 points from `buildSyntheticSparkline(quote)` using OHLC anchors. NOT real intraday data.

---

## 8. Jintel API — What It Provides vs. What We Need

### What Jintel Returns for `quotes(tickers)`

```typescript
{
  ticker: string;
  price: number;           // current/last price
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  change: number;          // price - previousClose (PER SHARE)
  changePercent: number;   // ((price - prevClose) / prevClose) * 100
  volume: number;
  marketCap: number | null;
  timestamp: string;
}
```

**How `change` is computed in Jintel** (`resolvers.ts:705`):
```typescript
change: q.price && q.previousClose ? q.price - q.previousClose : 0
```

This is a **per-share dollar change**, not per-position.

### Data Gap Table

| Feature | Jintel Provides | Yojin Needs | Gap |
|---------|----------------|-------------|-----|
| Current price | Yes (`quotes`) | Yes | No gap |
| Per-share day change | Yes (`change`) | Needs per-position | **Must multiply by quantity on Yojin side** |
| Day change % | Yes (`changePercent`) | Yes | No gap (% is same per-share and per-position) |
| OHLC (today only) | Yes | For sparklines | No gap |
| Price history (1D/1W/1M/3M/1Y) | **No** — `history` resolver returns `[]` | For real sparklines | **Gap** — sparklines are synthetic OHLC interpolation |
| Historical portfolio value | **No** | For time-series charts | Handled by Yojin's snapshot JSONL |
| Cost basis | **No** | For PnL | User-entered or scraped — not from Jintel |
| Dividends / realized PnL | **No** | Not yet needed | Not implemented anywhere |
| Intraday candles | **No** | For intraday charts | **Gap** — not available via API |

### Jintel Has Candle Data Internally (Not Exposed)

The `technicals` connector in Jintel fetches OHLCV candle history via Yahoo Finance to compute indicators (RSI, MACD, etc.), but the raw candles are NOT exposed through the GraphQL API. The `history` field in the schema returns `[]`.

---

## 9. Current Snapshot Data (Your Actual Data)

Your `~/.yojin/snapshots/portfolio.jsonl` has **8 snapshots** over 2 days:

| # | Timestamp | totalValue | totalCost | totalPnl | Positions |
|---|-----------|-----------|-----------|----------|-----------|
| 1 | 2026-03-25 12:18 | $30.93 | $30.93 | $0.00 | 11 |
| 2 | 2026-03-25 12:54 | $61.86 | $61.86 | $0.00 | 22 |
| 3 | 2026-03-25 13:05 | $92.79 | $92.79 | $0.00 | 33 |
| 4 | 2026-03-25 14:05 | $63,092.79 | $63,092.79 | $0.00 | 34 |
| 5 | 2026-03-25 14:10 | $63,158.79 | $63,158.79 | $0.00 | 35 |
| 6 | 2026-03-25 15:11 | $63,158.79 | $63,158.79 | $0.00 | 35 |
| 7 | 2026-03-25 15:25 | $63,158.79 | $63,158.79 | $0.00 | 35 |
| 8 | 2026-03-26 09:13 | $74,422.79 | $74,422.79 | $0.00 | 36 |

### What This Means for Charts

**After dedup (1 per day):**
- March 25: $63,158.79 (last snapshot that day)
- March 26: $74,422.79
- Plus live trailing point (if Jintel returns different prices)

**Only 2 data points** after dedup. The charts will show a single flat line or a single jump.

**All positions have `totalPnl = 0`** because they were manually added with `costBasis = currentPrice`. At query time, `enrichWithLiveQuotes` will reprice them with live Jintel prices, which WILL change `totalValue` and `totalPnl` — but only for symbols that Jintel recognizes. Fake symbols like "SDASD" and "DDASD" won't have quotes and will keep `currentPrice = costBasis`.

**The stored PnL bars will ALL be zero** because stored `totalPnl = 0` in every snapshot. The P&L bar chart derives PnL as `todayTotalValue - yesterdayTotalValue`, which shows the value change between days — but only 1 bar (Mar 26) will be non-zero, showing `+$11,264`.

---

## 10. Confirmed Bugs

### BUG 1: `dayChange` is per-share, not per-position (CRITICAL)

**File:** `src/api/graphql/resolvers/portfolio.ts:119`

```typescript
dayChange: quote.change,  // ← BUG: per-share change, not per-position
```

Jintel's `quote.change` = `price - previousClose` = the per-share dollar change.

The frontend sums this across positions:
```typescript
const change = positionList.reduce((sum, p) => sum + (p.dayChange ?? 0), 0);
```

For a position with 100 shares of AAPL where AAPL moved +$1.50:
- **Current behavior:** Adds $1.50 to portfolio change
- **Correct behavior:** Should add $150.00 (100 * $1.50)

**Fix:**
```typescript
dayChange: quote.change * pos.quantity,
```

### BUG 2: P&L chart shows "No P&L data yet" with < 2 history points

**File:** `apps/web/src/components/portfolio/performance-overtime.tsx:45`

```typescript
if (history.length < 2) return [];
```

After dedup, you need at least 2 calendar days of snapshots to see ANY P&L bars. With only 2 days of data (March 25-26), you'll see at most 1-2 bars. If time scale filters to < 2 points, you get empty state.

**This is why the P&L chart disappears.** With 7D selected and only 2 days of data, you'll see something — but if the cutoff falls between your two days, you'll have only 1 point, which triggers the empty return.

### BUG 3: Charts don't change when switching time frames

**Root cause:** You only have 2 days of snapshot history (March 25-26). ALL time scales (7D, 1M, 3M, YTD) produce the same result because both days fall within every window. The filtering logic is correct — you just don't have enough data points for the time scales to differentiate.

### BUG 4: TotalValueGraph makes redundant `usePortfolioHistory()` call

**File:** `apps/web/src/components/portfolio/total-value-graph.tsx:54`

`PortfolioOverview` already fetches history and passes it to `PerformanceOvertime`, but `TotalValueGraph` calls `usePortfolioHistory()` independently. The urql cache prevents a double network call, but the component has independent loading/error states that don't coordinate with the parent.

If the cache entry expires or the parent has different timing, `TotalValueGraph` could show a spinner while `PerformanceOvertime` shows data (or vice versa).

### BUG 5: Total value shown may not match actual portfolio reality

Since all manually added positions use `currentPrice = costBasis`, the stored `totalValue` reflects what you entered, not market reality. `enrichWithLiveQuotes` tries to fix this at query time, but only for recognized tickers.

Test positions with fake symbols (SDASD, DDASD) will forever keep their manual `costBasis` as `currentPrice`, inflating or deflating `totalValue` from reality.

### BUG 6: Tooltip may not show on TotalValueGraph hover

The `ValueTooltip` component uses `label` from Recharts, which comes from the `XAxis` `dataKey`. The XAxis is hidden (`hide`), but the `dataKey="date"` still provides `label` to the tooltip. However, when `ensureMinPoints()` adds a synthetic first point with `date: ''`, hovering over that first point shows an empty date in the tooltip: `" · $63,158.79"` (leading space, no date).

### BUG 7: `getScaleDays()` duplicated with subtle differences

**Files:**
- `total-value-graph.tsx:20-27` — uses `SCALE_DAYS` Record + special YTD
- `performance-overtime.tsx:20-28` — uses inline Record + same YTD logic

These are functionally identical but separately maintained. If one is updated and the other isn't, the two charts will filter to different time windows.

---

## 11. Architectural Issues

### Issue 1: No Automated Snapshot Scheduling

Snapshots are only created when:
- User manually adds/edits/removes a position
- A brokerage connection syncs (requires explicit `refreshPositions` or initial connection)

There is **no daily automatic scrape or snapshot**. The scheduler (`src/scheduler.ts`) runs insights analysis on existing data — it does NOT take new snapshots. This means the portfolio JSONL only grows when a user action triggers a save, resulting in sparse and uneven history.

**Impact:** Charts will have gaps on days with no user activity. P&L bars show 0 on those days.

### Issue 2: JSONL Reads Entire File on Every Query

Both `getLatest()` and `getAll()` read the entire JSONL file. `getLatest()` reads all lines to find the last one. As the file grows (months/years of snapshots), this becomes O(N) on every portfolio query.

### Issue 3: No Server-Side Time Filtering

The `portfolioHistory` query returns ALL snapshots. With 1+ year of data (365+ deduped points), the entire history is sent to the frontend on every load.

### Issue 4: `totalCost` Formula Divergence

| Location | Formula | Result |
|----------|---------|--------|
| `snapshot-store.ts:56` | `totalCost = totalValue - totalPnl` | Inverse derivation |
| `portfolio.ts:129` | `totalCost = sum(costBasis * qty)` | Direct sum |

These produce different results when positions have `costBasis = 0` or when `unrealizedPnl` has floating-point rounding. The historical chart uses stored formula; the live card uses the direct formula.

### Issue 5: `enrichedSnapshot` N+1

`enrichedSnapshotQuery` calls `jintelClient.enrichEntity(symbol, ['market'])` once per position in `Promise.all()`. For a 20-position portfolio = 20 Jintel API calls. The `quotes()` batch call avoids this, but enrichment doesn't.

### Issue 6: Orphaned Legacy Components

These files exist but are NOT mounted anywhere:
- `apps/web/src/components/portfolio/portfolio-chart.tsx` — uses `generateMockData()` (pure mock)
- `apps/web/src/components/portfolio/total-value-chart.tsx` — superseded by `TotalValueGraph`

### Issue 7: `mock-chart-data.ts` Misleading Name

Both `TotalValueGraph` and `PerformanceOvertime` import `tooltipStyle` from `lib/mock-chart-data.ts`. The file name suggests mock data but `tooltipStyle` is used in production. Should be split: extract production utilities to `chart-utils.ts`.

---

## 12. Fix Recommendations

### Critical Fixes (Correct wrong data)

#### Fix 1: `dayChange` must be per-position, not per-share

**File:** `src/api/graphql/resolvers/portfolio.ts:119`

```diff
- dayChange: quote.change,
+ dayChange: quote.change * pos.quantity,
```

This fixes the Portfolio Value Card's daily change display.

#### Fix 2: Standardize `totalCost` formula

Pick ONE formula and use it everywhere. The direct sum is more accurate:

**File:** `src/portfolio/snapshot-store.ts:56`

```diff
- const totalCost = totalValue - totalPnl;
+ const totalCost = merged.reduce((sum, p) => sum + p.costBasis * p.quantity, 0);
```

### Important Fixes (Correct chart behavior)

#### Fix 3: Add automated daily snapshots

Create a scheduled task that takes a snapshot at least once daily (even without user activity). This ensures the history has at least 1 point per day, making time-scale switching meaningful.

Options:
- Add to `src/scheduler.ts`: call `enrichWithLiveQuotes(latest)` → `snapshotStore.save()` daily
- Or: add a cron to `syncPlatform()` for connected platforms

#### Fix 4: Pass history to `TotalValueGraph` as prop

**File:** `apps/web/src/components/portfolio/portfolio-overview.tsx`

`PortfolioOverview` already fetches history. Pass it to `TotalValueGraph` instead of having it fetch independently:

```diff
- <TotalValueGraph scale={scale} />
+ <TotalValueGraph scale={scale} history={history} />
```

And update `TotalValueGraph` to accept `history` as a prop instead of calling `usePortfolioHistory()`.

#### Fix 5: Extract `getScaleDays()` to shared utility

**File:** `apps/web/src/lib/time-scales.ts`

```typescript
export const SCALE_DAYS: Record<TimeScale, number> = {
  '7D': 7,
  '1M': 30,
  '3M': 90,
  YTD: Infinity, // special-cased
};

export function getScaleDays(scale: TimeScale): number {
  if (scale === 'YTD') {
    const now = new Date();
    const jan1 = new Date(now.getFullYear(), 0, 1);
    return Math.ceil((now.getTime() - jan1.getTime()) / 86_400_000);
  }
  return SCALE_DAYS[scale];
}
```

Delete the duplicated functions in `total-value-graph.tsx` and `performance-overtime.tsx`.

#### Fix 6: Handle single-point tooltip edge case

In `TotalValueGraph`, when `ensureMinPoints` creates a synthetic first point, set its `date` to something meaningful instead of `''`:

```diff
- return [{ date: '', value: only.value }, only];
+ return [{ date: only.date, value: only.value }, only];
```

### Nice-to-Have Fixes

#### Fix 7: Add server-side time filtering to `portfolioHistory`

Add an optional `since` argument to the GraphQL query so the server can filter before sending:

```graphql
type Query {
  portfolioHistory(since: String): [PortfolioHistoryPoint!]!
}
```

#### Fix 8: Rename `mock-chart-data.ts`

Split into:
- `lib/chart-utils.ts` — `tooltipStyle`, `formatValue` (production)
- `lib/mock-chart-data.ts` — `generateMockData`, `timeRanges`, `RANGE_DAYS` (dev only)

#### Fix 9: Clean up orphaned components

Delete `portfolio-chart.tsx` and `total-value-chart.tsx` — they are superseded and not mounted.

---

## Appendix: File Reference

### Backend (Yojin)
| File | Purpose |
|------|---------|
| `src/portfolio/snapshot-store.ts` | JSONL read/write, merge logic, totalCost formula |
| `src/api/graphql/resolvers/portfolio.ts` | All portfolio resolvers, `enrichWithLiveQuotes`, history dedup |
| `src/api/graphql/types.ts` | `Position`, `PortfolioSnapshot`, `PortfolioHistoryPoint` interfaces |
| `src/api/graphql/schema.ts` | GraphQL SDL types and queries |
| `src/api/graphql/pubsub.ts` | WebSocket pub/sub for `onPortfolioUpdate` |
| `src/composition.ts` | Dependency injection for resolvers |
| `src/scraper/connection-manager.ts` | Brokerage sync path |
| `src/tools/portfolio-tools.ts` | Agent tool path for saving positions |
| `src/jintel/price-provider.ts` | Documents Jintel limitation (current-day only) |

### Frontend (Yojin Web)
| File | Purpose |
|------|---------|
| `apps/web/src/pages/dashboard.tsx` | Dashboard grid layout |
| `apps/web/src/components/overview/portfolio-value-card.tsx` | Total value + daily change display |
| `apps/web/src/components/overview/positions-preview.tsx` | Top 5 positions + sparklines |
| `apps/web/src/components/portfolio/portfolio-overview.tsx` | Chart card orchestrator with time-scale buttons |
| `apps/web/src/components/portfolio/total-value-graph.tsx` | Area chart (total value over time) |
| `apps/web/src/components/portfolio/performance-overtime.tsx` | Bar chart (daily P&L) |
| `apps/web/src/components/portfolio/portfolio-stats.tsx` | Stats display (not on dashboard) |
| `apps/web/src/api/documents.ts` | All GraphQL operation documents |
| `apps/web/src/api/hooks/use-portfolio.ts` | urql hooks for portfolio queries |
| `apps/web/src/api/types.ts` | Client-side TypeScript types |
| `apps/web/src/lib/time-scales.ts` | `TimeScale` type definition |
| `apps/web/src/lib/mock-chart-data.ts` | `tooltipStyle` (production) + mock generators (legacy) |
| `apps/web/src/lib/graphql.ts` | urql client, cache config, invalidation rules |

### Jintel Backend
| File | Purpose |
|------|---------|
| `../Jintel/src/graphql/schema.ts` | Jintel's GraphQL schema (NO portfolio types) |
| `../Jintel/src/graphql/resolvers.ts` | `change = price - previousClose` (per-share), `history` returns `[]` |
| `../Jintel/src/connectors/market/yfinance.ts` | Yahoo Finance connector for batch quotes |
| `../Jintel/src/connectors/technicals/technicals.ts` | Has candle data but doesn't expose it via API |
