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
- Never swallow errors silently.
- In `finally` blocks, wrap cleanup in its own try/catch to avoid suppressing the original exception.
- When a function has setup + action + cleanup, decide explicitly whether setup failure should abort or be best-effort. Match the error strategy symmetrically.

## Wiring Completeness

- **Wire optional dependencies at every call site.** When adding an optional parameter to an interface (e.g. `memoryStore?: SignalMemoryStore`), TypeScript won't warn if callers omit it. Grep for all call sites of the function/constructor and wire the new dependency at each one — or the feature will be silently dead in production behind an `if (dependency)` guard.
- **Apply conditional patterns symmetrically.** When multiple agents in a workflow use the same `hasX ? value : fallback` pattern, apply it consistently to all agents — don't hardcode values for some while making others conditional.
- **Don't expose dead API surface.** If a GraphQL mutation, query, or resolver depends on a setter (e.g. `setXPipeline`) that is never called in the composition root or `run-main.ts`, remove it from the schema until it's wired. Dead mutations silently return fallback values, confusing both API consumers and future developers.
- **New module wiring checklist.** When adding a new store or domain module (e.g. `ActionStore`, `SkillStore`, `SnapStore`), complete all four wiring steps: (1) add the data directory to `DATA_SUBDIRS` in `src/paths.ts`, (2) instantiate + wire via setter in `src/composition.ts`, (3) import and register resolvers in `src/api/graphql/server.ts` (Query + Mutation maps), (4) add schema types in `src/api/graphql/schema.ts`. Missing any step leaves the feature silently broken at runtime.
- **Mirror guards across duplicate workflow files.** When two workflow files share the same stage structure (e.g. `assessment-workflow.ts` and `full-curation-workflow.ts`), any guard added to one (like an empty-data early return in `buildMessage`) must be added to the other. Before committing, grep for the guarded pattern across all sibling workflows.

## Missing Data Defaults

- **Don't default missing data to values that satisfy conditions.** Using `?? 0` for a numeric lookup that feeds a threshold comparison (e.g. `value ?? 0` into `value <= threshold`) will fire the condition when data is absent. Skip the check (`return null`) when the input is `undefined` — absent data means "can't evaluate", not "value is zero".
- **Don't ship mock data as production fallback.** When a resolver or hook depends on an optional backing store (e.g. `EventLog`), return an empty result when the store isn't wired — not fabricated events. Mock data belongs in tests and Storybook, not in runtime code paths.

## Signal & Data Dedup

- **Content hashes must be stable across re-runs.** The ingestor hashes `title | YYYY-MM-DD` (day-precision). When creating `RawSignalInput` for enrichment data (fundamentals, technicals), set `publishedAt` to a stable value (start-of-day), not `new Date().toISOString()`. A ms-precision timestamp produces a new hash on every run, defeating dedup.
- **Shared data points need title-level dedup.** The signals resolver dedupes by normalized title, keeping the latest `publishedAt`. When adding a new signal source that produces recurring snapshots (like fundamentals), the same data point WILL appear across days — the resolver handles this, don't try to prevent it at the archive level.

## Refactoring — Ask First

Before making breaking changes to:
- Agent profiles or tool scoping
- Plugin interfaces (ProviderPlugin, ChannelPlugin)
- Guard pipeline order or behavior
- Data file formats (JSONL schemas, config structure)
- YojinContext shape
