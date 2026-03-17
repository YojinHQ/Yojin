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
- Define interfaces for module boundaries (e.g., `IPortfolioScraper`, `Guard`, `RiskManager`).
- Prefer `interface` over `type` for object shapes that will be implemented.

## Patterns
- Async/await everywhere — no raw Promise chains or callbacks.
- Use `Result`-style returns (`{ success: true, data } | { success: false, error }`) over thrown exceptions for expected failures.
- Thrown errors are for unexpected/programmer errors only.
- Use tslog for structured logging (already configured in `src/logging/`).

## Naming
- Files: kebab-case (`agent-runtime.ts`, `guard-runner.ts`).
- Classes: PascalCase (`AgentRuntime`, `GuardRunner`).
- Interfaces: PascalCase, no `I` prefix except for scraper interfaces that already use it (`IPortfolioScraper`).
- Functions/methods: camelCase.
- Constants: UPPER_SNAKE_CASE for true constants, camelCase for derived values.

## Imports
- Group imports: node builtins, external packages, internal modules.
- Use `import type` for type-only imports.
