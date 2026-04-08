---
name: codex-refactor
description: Have Codex refactor code with safety checks.
argument-hint: "<file or description of what to refactor>"
---

Delegate a refactoring task to Codex with built-in safety: Codex refactors, then both Claude and Codex verify no regressions.

## Steps

### Step 1: Understand the request

`$ARGUMENTS` should describe what to refactor. If empty, ask the user. Examples:
- `src/signals/archive.ts` — refactor the entire file
- `extract the enrichment logic from composition.ts` — specific extraction
- `simplify the guard pipeline` — targeted simplification

### Step 2: Snapshot current state

Before any changes:
- Run `pnpm test -- --reporter=verbose` and save the test results count (pass/fail/skip)
- Run `pnpm typecheck` to confirm clean baseline
- If either fails, warn the user and ask whether to proceed

### Step 3: Delegate to Codex

Run `/codex:rescue --wait` with a prompt that includes:
- The refactoring request: `$ARGUMENTS`
- Project conventions: ESM, strict TypeScript, NodeNext resolution, `.js` import extensions, Zod schemas, Result-style errors, no `any`
- Key constraint: preserve all existing behavior — this is a refactor, not a feature change
- Instruction to NOT add features, docstrings, or "improvements" beyond the refactoring scope
- Instruction to run `pnpm typecheck` after changes

### Step 4: Verify no regressions

After Codex finishes:
1. Run `pnpm typecheck` — must still pass
2. Run `pnpm test -- --reporter=verbose` — compare pass/fail counts with Step 2 snapshot
3. Run `/regression-dog` to check for behavioral changes
4. Present a summary: what changed, test results, any behavioral deltas

### Step 5: User decision

Capture the list of files Codex changed (from `git diff --name-only`). Then ask whether to:
- Accept the refactor and commit
- Revert only Codex-touched files (`git restore -- <file1> <file2> ...` using the captured list)
- Ask Codex to adjust
