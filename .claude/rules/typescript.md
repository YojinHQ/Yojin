---
description: TypeScript coding conventions for Yojin
globs: ["**/*.{ts,tsx}"]
---

# TypeScript Conventions

## Module System
- ESM only (`"type": "module"` in package.json).
- Use `.js` extensions in imports (NodeNext resolution requires this).
- No CommonJS (`require`, `module.exports`).

## Type Safety
- Strict mode enabled — no `any` unless absolutely necessary (and comment why).
- Use Zod schemas for all external data: config files, API responses, user input.
- **Reuse typed Zod schemas.** When a typed schema exists (e.g. `PlatformSchema`, `AssetClassSchema`), use it instead of `z.string()`. This ensures `z.infer` produces the correct type and eliminates casts. If your Zod-inferred type doesn't match the interface, fix the schema — don't add `as T`.
- Define interfaces for module boundaries (e.g., `IPortfolioScraper`, `Guard`, `RiskManager`).
- Prefer `interface` over `type` for object shapes that will be implemented.
- **Types must match runtime shape.** If a field is stripped at runtime (destructured out, deleted), `Omit` it from the type. Never use `as unknown as T` to hide a mismatch — create a purpose-built type instead.
- **No unreachable union branches.** If a type says `string | number` but only `number` is reachable at runtime, use `number`. Dead branches mislead consumers and create dead defensive code.
- **Non-empty identity fields.** Zod string fields used as IDs, dedup keys, or lookup keys (e.g. `id`, `contentHash`, `ticker`) must use `.min(1)` — bare `z.string()` accepts `""`, which silently breaks dedup, lookups, and joins. Similarly, arrays that must have at least one entry (e.g. provenance `sources`) need `.min(1)`.
- **Use enum constants, not string literals.** When a Zod schema defines an enum (e.g. `SignalTypeSchema`, `SourceTypeSchema`), use its `.enum` property (e.g. `SignalTypeSchema.enum.NEWS`) instead of raw string literals (`'NEWS'`). This catches typos at compile time, enables rename refactoring, and keeps the schema as the single source of truth.

## Patterns
- Async/await everywhere — no raw Promise chains or callbacks.
- Use `Result`-style returns (`{ success: true, data } | { success: false, error }`) over thrown exceptions for expected failures.
- Thrown errors are for unexpected/programmer errors only.
- Use tslog for structured logging (already configured in `src/logging/`).
- **Best-effort symmetry.** If cleanup is wrapped in try/catch (best-effort), the setup/injection should be too — unless you intentionally want setup failure to abort. Document the choice.
- **Preserve original exceptions in `finally`.** Wrap cleanup calls in `finally` blocks with their own try/catch so a cleanup failure doesn't suppress the original error.

## Naming
- Files: kebab-case (`agent-runtime.ts`, `guard-runner.ts`).
- Classes: PascalCase (`AgentRuntime`, `GuardRunner`).
- Interfaces: PascalCase, no `I` prefix except for scraper interfaces that already use it (`IPortfolioScraper`).
- Functions/methods: camelCase.
- Constants: UPPER_SNAKE_CASE for true constants, camelCase for derived values.

## String Matching
- **Use word boundaries when matching identifiers in text.** Plain `string.includes(sym)` will match short tickers (e.g. "A", "T", "MO") as substrings of unrelated words ("MACRO", "TECH", "MOMENTUM"). Use `RegExp` with `(?<![A-Z0-9])` / `(?![A-Z0-9])` lookaround instead. Always escape user/data-derived strings before `new RegExp()` interpolation — tickers like `BRK.B` contain regex metacharacters.

## React
- **Keep reducers and subscription handlers pure.** urql `useSubscription` reducers and React `useReducer` handlers must not call `setState`, trigger queries, or produce other side effects. Derive state from the accumulated result and handle side effects in a separate `useEffect`.
- **Check urql results for errors (queries and mutations).** `useMutation` execute functions return `Promise<OperationResult>` that **never rejects** — GraphQL and network errors arrive via `result.error`, not thrown exceptions. Always check `result.error` before showing success state. For `useQuery`, check `result.error` before the empty-data fallback — a failed query should show an error state, not a misleading "no data yet" CTA.
- **Use `network-only` for detection/auth queries.** Queries that detect environment state (credentials, feature flags, system capabilities) must use `requestPolicy: 'network-only'`. These variable-free queries cache on the query string alone — `cache-first` returns stale results if the user navigates away, changes state, and returns.
- **Extract shared components.** When a UI component (e.g. `SignalChips`) or utility (e.g. `timeAgo`) is duplicated across 2+ sibling files, extract it into a shared module immediately.
- **Don't derive semantic meaning from CSS class names.** Use explicit data fields (e.g. `variant: 'accent'`) instead of parsing Tailwind utility strings to determine behavior.
- **Distinguish loading from empty.** When a query result is `undefined`, check `result.fetching` before showing the no-data fallback. Users should see a loading indicator during fetch, not a misleading "no data yet" CTA.
- **Memoize query variables.** `useQuery` variables that contain computed values (e.g. `new Date().toISOString()`) must be wrapped in `useMemo`. An unstable reference makes urql treat every render as a new query, causing an infinite fetch loop. If a variable changes per-millisecond (timestamps, UUIDs), it **will** loop.
- **Register every GraphQL type in graphcache keys.** When adding a new type to the schema, add a key resolver in `src/lib/graphql.ts`. Types that appear as nested objects on multiple parents (e.g. `SignalSource` shared across many `Signal` entries) must use `() => null` (embedded, not normalized) — otherwise graphcache merges unrelated parents into one cache entry.
- **No business logic in the UI.** React components must not derive, compute, or transform domain values (e.g. `quantity * price`, PnL calculations, percentage changes). All computed values must come from the backend via GraphQL queries, mutations, or subscriptions. The UI is a render layer — it formats and displays what the BE returns, nothing more.
- **Modal children must never return `null`.** When a component is rendered inside a `<Modal>` wrapper, returning `null` from the child leaves an empty, potentially uncloseable dialog (backdrop visible, no content or close button). Always render a loading spinner or placeholder — and ensure the close button is always reachable, either in the wrapper or in every child branch.
- **Icon-only buttons need `aria-label`.** Any `<button>` whose visible content is only an icon (SVG, icon component) must include `aria-label` describing its action (e.g. `aria-label="Close"`). Screen readers announce unlabelled buttons as empty, making the UI inaccessible.
- **Store `setTimeout` and `requestAnimationFrame` handles for any cancelable async work in effects.** Whenever a `useEffect` schedules a `setTimeout`, `requestAnimationFrame`, or chained combination, store the handles in `useRef`s and clear them in the effect's cleanup function. This applies to **any** deferred work — clearing state (glow animations, toast dismissals), deferring `setState` to satisfy `react-hooks/set-state-in-effect`, focusing/selecting DOM nodes, etc. Bare timers cause race conditions when the effect re-fires before the previous timer resolves: the first callback overwrites state with stale closure values. Capture changing prop values in a local `const` inside the effect so the deferred callback isn't affected by later prop changes.
- **Deduplicate identical polling queries.** When two mounted components poll the same GraphQL query with `network-only`, urql sends two network requests per cycle. Use `cache-and-network` so urql deduplicates the request — only one component needs a `setInterval` poll, the other reads from cache updates.
- **Detect value changes in `useEffect`, not render phase.** To detect when a query result value changes (e.g. `snap.generatedAt`), use a `useEffect` with the value as dependency and a `useRef` for the previous value. Avoid render-phase `setState` (the "getDerivedStateFromProps" pattern) — it causes extra re-renders in Strict Mode and is harder to reason about. When the ESLint rule `react-hooks/set-state-in-effect` blocks synchronous `setState` in the effect, defer with `setTimeout(fn, 0)`.
- **Sort by the field you display.** If a list renders `publishedAt` timestamps, sort by `publishedAt`. Sorting by a different field (e.g. `ingestedAt`) makes the visual order disagree with the shown dates. Check: the `sort()` key must match the field the user sees.
- **Sentinel fallbacks must not leak into display data.** Internal sentinel strings (e.g. `'MACRO'`, `'UNKNOWN'`) used as fallbacks when real data is absent must be filtered out before passing to display components. A sentinel in `relatedTickers` or a chip renders as a fake tradeable symbol. Strip sentinels at the mapping layer, not in the component.
- **Clickable divs must use `<button>`.** Any `<div onClick>` that acts as a button is keyboard-inaccessible. Replace with `<button type="button">` and add `aria-expanded` when it controls a collapsible region. Add `w-full text-left` to preserve the full-width layout in flex/grid contexts.
- **Always declare `type="button"` on non-submit buttons.** A bare `<button>` defaults to `type="submit"`, so if the component is ever placed inside a `<form>` (or wrapped in one later) the click will trigger form submission and a full page navigation. Every `<button>` that isn't an explicit form-submit must declare `type="button"`. Apply this symmetrically to **every** button in a component — not just the one a reviewer flagged.
- **Use `setInterval` for timestamps that must stay current.** `useState(0)` + one-shot `setTimeout(() => setNowMs(Date.now()), 0)` captures the time at mount and never updates it. Any UI that computes a countdown or elapsed time from that value becomes permanently stale. Use `useState(() => Date.now())` to initialise and `setInterval(() => setNowMs(Date.now()), N)` + `clearInterval` on unmount to keep it live.
- **Gate banners on pending work, not recent activity.** A `throttledCount` (or similar "recently-did-X" counter) is non-zero even when there is nothing left to process. Banners and triggers that fire on this counter show false-positive warnings. Use `pendingCount > 0` (or equivalent "has work waiting" field) as the primary gate, then require `throttledCount > 0` as a secondary condition.
- **Settings form dirty-check must track a local saved baseline, not the query result.** When a mutation returns `Boolean` instead of the updated object, the query cache never refreshes. Track a separate `savedValue` state initialized from the query result and updated on successful save. `handleSelect` compares against `savedValue`, not `queryResult.field` — otherwise selecting the original value after saving is incorrectly treated as clean until reload.
- **When resetting paginated view state, reset the scroll container too.** If a filter/tab change resets `displayedCount` back to `PAGE_SIZE` but leaves the scroll position where it was, an IntersectionObserver sentinel at the bottom of the list will still be inside its root margin and immediately re-expand `displayedCount` on the next render — the reset never visually "sticks" and top-ranked items stay off-screen. Any place that resets paginated state must also call `containerRef.current?.scrollTo({ top: 0, behavior: 'auto' })`.
- **Read DOM/ref state directly when gating a fresh side-effect, not debounced React state.** A `scroll`-handler-maintained `isScrolledDown` boolean lags the actual viewport by up to a frame; using it to decide whether a freshly-arrived item is "visible" or "off-screen" races with the item's arrival. Read `containerRef.current?.scrollTop` directly inside the effect that fires on new data — the DOM is the source of truth for instantaneous viewport questions.
- **Cross-filter UI announcements must be gated by the filter that can actually render them.** If a "N new items" banner, pill, or toast references items of a specific category (e.g. HIGH/CRITICAL alerts), and a tab filter can exclude that category entirely (e.g. Insights hides all alerts), the banner must also hide on the incompatible tab — its CTA would otherwise scroll to a list that can't contain the announced items. Gate on `activeFilter !== 'incompatible_filter'` alongside the usual visibility conditions.
- **Version client-persisted keys when the semantics of what they store change.** Keys in `localStorage` / `sessionStorage` outlive code rollouts. If you widen a query window (e.g. fetch 20 → 100), change a dedup hash format, or flip the meaning of a stored Set, bump the key's version suffix (e.g. `intel-feed-seen-` → `intel-feed-seen-v2-`). Existing tabs restoring the old snapshot would otherwise contaminate the new code path.

## Imports
- Group imports: node builtins, external packages, internal modules.
- Use `import type` for type-only imports.
