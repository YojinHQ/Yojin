---
description: TypeScript coding conventions for Yojin
globs: ["**/*.ts"]
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
- **Extract shared components.** When a UI component (e.g. `SignalChips`) or utility (e.g. `timeAgo`) is duplicated across 2+ sibling files, extract it into a shared module immediately.
- **Don't derive semantic meaning from CSS class names.** Use explicit data fields (e.g. `variant: 'accent'`) instead of parsing Tailwind utility strings to determine behavior.
- **Distinguish loading from empty.** When a query result is `undefined`, check `result.fetching` before showing the no-data fallback. Users should see a loading indicator during fetch, not a misleading "no data yet" CTA.
- **Memoize query variables.** `useQuery` variables that contain computed values (e.g. `new Date().toISOString()`) must be wrapped in `useMemo`. An unstable reference makes urql treat every render as a new query, causing an infinite fetch loop. If a variable changes per-millisecond (timestamps, UUIDs), it **will** loop.
- **Register every GraphQL type in graphcache keys.** When adding a new type to the schema, add a key resolver in `src/lib/graphql.ts`. Types that appear as nested objects on multiple parents (e.g. `SignalSource` shared across many `Signal` entries) must use `() => null` (embedded, not normalized) — otherwise graphcache merges unrelated parents into one cache entry.

## Imports
- Group imports: node builtins, external packages, internal modules.
- Use `import type` for type-only imports.
