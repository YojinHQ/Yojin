---
name: codex-test
description: Have Codex write or fix tests for specified files.
argument-hint: "<file path or pattern>"
---

Delegate test writing or fixing to Codex. Codex will analyze the source file, understand its behavior, and produce comprehensive tests.

## Steps

### Step 1: Determine target

If `$ARGUMENTS` is provided, use it as the target file(s).
If empty, use `git diff --name-only HEAD~1` to find recently changed files.

### Step 2: Gather context

For each target file:
- Read the source file to understand what it does
- Check if a test file already exists (in `test/` directory or co-located as `*.test.ts`)
- If tests exist, read them to understand current coverage
- Find an existing test in the project to use as a style reference

### Step 3: Delegate to Codex

Run `/codex:rescue --wait` with a prompt that includes:
- The source file path(s) and their content summary
- Existing test file content (if any)
- Testing conventions:
  - Framework: vitest (not jest, not mocha)
  - Use `describe`/`it` blocks
  - Test names describe behavior, not implementation
  - Prefer real data fixtures over mocks
  - Use Result-style returns for expected failures
  - Don't mock the LLM provider — test tool execution and data flow
  - ESM imports with `.js` extensions
- Instruction to write tests that cover: happy path, edge cases, error cases, and boundary conditions
- Instruction to run `pnpm test -- --reporter=verbose <test-file>` to verify tests pass

### Step 4: Verify

After Codex finishes:
1. Run the new/updated tests: `pnpm test -- --reporter=verbose <test-file>`
2. Show test results to the user
3. If tests fail, ask whether to fix or adjust
