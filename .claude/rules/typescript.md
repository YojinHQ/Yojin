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

## Imports
- Group imports: node builtins, external packages, internal modules.
- Use `import type` for type-only imports.
