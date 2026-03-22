---
description: Testing conventions using vitest
globs: ["test/**/*.ts", "**/*.test.ts", "**/*.spec.ts"]
---

# Testing Rules

## Framework
- vitest for all tests. No jest, no mocha.
- Test files go in `test/` directory or co-located as `*.test.ts`.

## What to Test
- Enrichment pipeline: PII redaction, dual-source merge, position analysis.
- Alert rules: each rule evaluated against mock enriched snapshots.
- Guard pipeline: each guard with pass/fail cases.
- Risk analysis: exposure breakdown, concentration scoring, correlation detection.
- Analysis kit: technical indicator calculations (SMA, RSI, BBANDS, etc.).
- Zod schemas: config validation, edge cases.

## What NOT to Test
- Don't mock the LLM provider for agent behavior tests — test tool execution and data flow instead.
- Don't test Playwright scraping in unit tests — those are integration/manual tests.

## Conventions
- Use `describe`/`it` blocks.
- Test names should describe the behavior, not the implementation.
- Prefer real data fixtures over mocks where possible.
- **Initialize `vi.mock` closure variables.** When a `vi.mock` factory closes over a `let` variable (e.g. `let defaultsRoot: string`), always initialize it (`= ''`). Vitest hoists `vi.mock()` to the top of the file — an uninitialized variable triggers TS2454 and risks `undefined` if evaluation order changes.
