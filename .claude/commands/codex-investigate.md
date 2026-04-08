---
name: codex-investigate
description: Delegate a bug investigation or codebase question to Codex.
argument-hint: "<description of the bug or question>"
---

Delegate an investigation task to Codex. Useful for debugging issues, understanding complex code paths, or getting a second opinion on how something works.

## Steps

### Step 1: Validate input

`$ARGUMENTS` must contain a description of what to investigate. If empty, ask the user what they'd like Codex to investigate.

### Step 2: Gather context

Quickly gather relevant context to help Codex:
- `git log --oneline -10` for recent changes
- `git diff --stat HEAD~3` for recently modified files
- Check if there are failing tests: `pnpm test --reporter=verbose 2>&1 | tail -30` (only if the investigation is about a failure)

### Step 3: Delegate to Codex

Run `/codex:rescue --wait` with a prompt that includes:
- The user's investigation request: `$ARGUMENTS`
- Any gathered context (recent changes, failing tests)
- Instruction to trace the code path, identify root cause, and propose a fix
- Instruction to output findings as: **Root Cause**, **Evidence**, **Suggested Fix**, **Files Involved**

### Step 4: Present findings

Show Codex's findings to the user. Ask whether to:
- Apply the suggested fix
- Investigate further
- Dismiss
