---
description: SOLID/DRY principles and code quality standards
globs: ["src/**/*.ts", "providers/**/*.ts", "channels/**/*.ts", "packages/**/*.ts"]
---

# Code Quality

## Single Responsibility

One module, one job. Agent profiles don't do enrichment. Guards don't analyze risk. The enrichment pipeline doesn't send alerts.

## Open/Closed

Extend via interfaces, not modification:
- New guard → implement `Guard` interface, register in guard registry
- New channel → implement `ChannelPlugin` interface in `channels/<id>/`
- New provider → implement `ProviderPlugin` interface in `providers/<id>/`
- New alert rule → implement rule interface in `src/alerts/rules/`
- New scraper → implement `IPortfolioScraper` in `src/scraper/platforms/`

## Dependency Inversion

- Depend on interfaces (`Guard`, `IPortfolioScraper`, `ChannelPlugin`), not concrete classes.
- The composition root (`src/main.ts`) wires everything — modules don't instantiate their own dependencies.
- No service locator pattern. Pass dependencies explicitly via `YojinContext`.

## DRY

- Zod schemas are the single source of truth for validation — don't duplicate checks.
- Shared types go in the module's `types.ts`, not duplicated across files.
- Config is loaded once in the composition root and passed via context.
- Extract when code appears 3+ times. Don't pre-abstract for hypothetical reuse.

## Error Handling

- Use Result-style returns (`{ success: true, data } | { success: false, error }`) for expected failures.
- Thrown errors are for unexpected/programmer errors only.
- Log errors with context before propagating: `logger.error('Failed to enrich', { symbol, error })`.
- **Log success after the operation, not before.** A log like `logger.info('Session deleted')` must come after `await rm(...)`, not before. If the operation fails, a pre-operation log creates a misleading entry. Exception: log errors before propagating (see above).
- **Reserve `warn` for unexpected or actionable conditions.** Expected paths (e.g. a data source intentionally left unconfigured) should use `debug` or `info`. `warn` implies something needs attention — if it fires on every normal startup, it's noise.
- Never swallow errors silently.
- **Don't retry a generator/stream after content has been yielded.** If a `for await` loop yields output before an error is thrown, retrying from scratch re-yields the full response — consumers accumulating output see doubled data. Track a `hasYieldedContent` flag and only retry if it is still false when the error is caught.
- In `finally` blocks, wrap cleanup in its own try/catch to avoid suppressing the original exception.
- When a function has setup + action + cleanup, decide explicitly whether setup failure should abort or be best-effort. Match the error strategy symmetrically.

## Wiring Completeness

- **Wire optional dependencies at every call site.** When adding an optional parameter to an interface (e.g. `memoryStore?: SignalMemoryStore`), TypeScript won't warn if callers omit it. Grep for all call sites of the function/constructor and wire the new dependency at each one — or the feature will be silently dead in production behind an `if (dependency)` guard.
- **Apply conditional patterns symmetrically.** When multiple agents in a workflow use the same `hasX ? value : fallback` pattern, apply it consistently to all agents — don't hardcode values for some while making others conditional.
- **Don't expose dead API surface.** If a GraphQL mutation, query, or resolver depends on a setter (e.g. `setXPipeline`) that is never called in the composition root or `run-main.ts`, remove it from the schema until it's wired. Dead mutations silently return fallback values, confusing both API consumers and future developers.
- **New module wiring checklist.** When adding a new store or domain module (e.g. `ActionStore`, `SkillStore`, `SnapStore`), complete all four wiring steps: (1) add the data directory to `DATA_SUBDIRS` in `src/paths.ts`, (2) instantiate + wire via setter in `src/composition.ts`, (3) import and register resolvers in `src/api/graphql/server.ts` (Query + Mutation maps), (4) add schema types in `src/api/graphql/schema.ts`. Missing any step leaves the feature silently broken at runtime.
- **Mirror guards across duplicate workflow files.** When two workflow files share the same stage structure (e.g. `assessment-workflow.ts` and `full-curation-workflow.ts`), any guard added to one (like an empty-data early return in `buildMessage`) must be added to the other. Before committing, grep for the guarded pattern across all sibling workflows.

## Early Returns in Gated Pipelines

- **Every early return from a multi-step pipeline must advance all completion flags.** When a pipeline has an `allItemsComplete()` handoff (e.g. micro→macro) and items can be skipped by intermediate gates (signal-gate, interval-gate, budget-gate), the early return must still mark those items as complete. Otherwise quiet items permanently block the handoff after `resetFlags()`. Rule: if an item passes through a stage without doing work (gated out), set `item.completedToday = true` (or equivalent) before returning, the same as if it had succeeded.

## Missing Data Defaults

- **Don't default missing data to values that satisfy conditions.** Using `?? 0` for a numeric lookup that feeds a threshold comparison (e.g. `value ?? 0` into `value <= threshold`) will fire the condition when data is absent. Skip the check (`return null`) when the input is `undefined` — absent data means "can't evaluate", not "value is zero".
- **Don't ship mock data as production fallback.** When a resolver or hook depends on an optional backing store (e.g. `EventLog`), return an empty result when the store isn't wired — not fabricated events. Mock data belongs in tests and Storybook, not in runtime code paths.

## Signal Routing & Classification

- **Classify by checking all entries, not just the first.** When routing items based on an array field (e.g. `signal.sources[]`), check the full array — not just `[0]`. After merge operations, later sources may change the semantics. Example: `signal.sources.every(s => s.type === 'ENRICHMENT')` is stable; `signal.sources[0]?.type === 'ENRICHMENT'` breaks if an API source is later prepended or merged in.
- **Write derived/synthetic records after, not before, the lookup that depends on prior history.** If step A writes records to a store and step B reads from that store to derive context (e.g. recent-signals for duplicate detection), step A must happen after step B completes. Writing first contaminates step B's context with the current batch's own output. Apply this ordering discipline whenever a write and a history-read target the same backing store in the same pipeline run.

## Signal & Data Dedup

- **Content hashes must be stable across re-runs.** The ingestor hashes `title | YYYY-MM-DD` (day-precision). When creating `RawSignalInput` for enrichment data (fundamentals, technicals), set `publishedAt` to a stable value (start-of-day), not `new Date().toISOString()`. A ms-precision timestamp produces a new hash on every run, defeating dedup.
- **Shared data points need title-level dedup.** The signals resolver dedupes by normalized title, keeping the latest `publishedAt`. When adding a new signal source that produces recurring snapshots (like fundamentals), the same data point WILL appear across days — the resolver handles this, don't try to prevent it at the archive level.
- **Respect the date-partition dimension.** Signal archive files are partitioned by `publishedAt` date. For reads: only use `publishedAt`-based bounds (e.g. `since`) as file-level hints — `sinceIngested` is a record-level filter, not a file-pruning hint. For writes: synthetic enrichment signals (snapshots, price moves) must use ingestion time (`now`), not the upstream data timestamp (e.g. `quote.timestamp`), which can be 1-3 days stale on weekends/after-hours and cause signals to vanish from recent-date UI filters.

## Enum-Driven Switches

- **Every enum value must have a switch case.** When a `z.enum()` drives a switch statement (e.g. `JINTEL_QUERY_KIND` → `jintel_query` switch), every enum member must have an explicit case. TypeScript won't catch the gap when there's a default/fallback branch — the call silently returns an error string at runtime. After adding a value to the enum, grep for every switch on that type and add the case. This also means: don't add a value to the enum if you can't wire it (remove `fama_french` rather than leaving it to fall through to "Unsupported").

## Parallel-Family Data Structures

- **Never use `a[0] ?? b[0] ?? c[0]` to read a multi-family struct.** When a type has parallel arrays holding domain-specific fields (e.g. `FinancialStatements.income`, `balanceSheet`, `cashFlow`), the `??` chain picks one winner and silently ignores the others. Read each family independently (`const inc = f.income[0]; const bs = f.balanceSheet[0]; ...`) and pull each metric from its correct source. The same rule applies to signal-fetcher sections that emit from structured sub-graphs — don't gate the signal on `income?.length` when `balanceSheet` or `cashFlow` alone would also be valuable.

## Coherent Decision Gates

- **When a new field becomes the priority signal, migrate all sibling gates.** If a field like `severity` takes over as the source of truth for one decision in a pipeline (e.g. "which action supersedes which"), every other gate that fans out from the same insight (notification gate, visibility, ranking, filtering) must move to the same field too. Leaving the notification gate on the legacy `rating × conviction` heuristic while the supersede logic uses `severity` creates a split-brain: a `VERY_BULLISH` rating with severity `0.1` still fires a user-facing alert even though the ranker would never promote it. After grep'ing for the new field, also grep for the old inputs (`rating ===`, `conviction >=`) to find sibling gates that need to be rewired.

## Two-Phase Writes With a Single Notification

- **Publish only at the final step of a multi-phase write.** When a pipeline writes a baseline, then merges it with fresh inputs to produce a final record (e.g. `regenerateSnap()` → `regenerateSnapFromMicro()`), only the final step should fire the `*.ready` event. If the intermediate step publishes first, a notification-cooldown (like `SNAP_NOTIFY_COOLDOWN_MS`) will swallow the merged-result notification and downstream consumers will hold the pre-merge `id`. Add a `skipPublish` (or equivalent) flag to the intermediate writer and pass it from the orchestrator — don't rely on cooldown timing to silence the extra event.

## Build Scripts — Don't Destroy What the Next Step Needs

- **Composite build scripts must not call cleanup helpers that wipe `node_modules`.** A script like `"build:release": "pnpm clean && tsc && pnpm --filter @yojin/web build"` looks reasonable, but if `pnpm clean` does `rm -rf dist && find . -name node_modules -prune -exec rm -rf {} +`, the next step (`tsc`) runs against a missing `node_modules/` and fails — or worse, succeeds partially in CI where `node_modules` gets restored by an earlier install step, masking the bug locally.
- **Scope cleanup to build artifacts only.** For release builds, use explicit paths: `rm -rf dist apps/web/dist && tsc && ...`. Never call a generic `clean` target that touches `node_modules/` from a script that immediately invokes a binary from `node_modules/.bin/`.
- **Check the full blast radius of any helper target you chain.** Before composing scripts with `&&`, read the helper's definition — a `clean` script in one repo means "rm -rf dist", in another means "nuke everything including installed deps". The name is not the contract.

## Refactoring — Ask First

Before making breaking changes to:
- Agent profiles or tool scoping
- Plugin interfaces (ProviderPlugin, ChannelPlugin)
- Guard pipeline order or behavior
- Data file formats (JSONL schemas, config structure)
- YojinContext shape
