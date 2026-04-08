---
name: dual-review
description: Run Claude and Codex reviews in parallel for comprehensive coverage.
argument-hint: "[--base <ref>] [scope: working-tree|branch|main]"
---

Run both Claude's code-reviewer agent and Codex's adversarial review in parallel against the same changes, then synthesize findings.

## Arguments

`$ARGUMENTS` can include:
- `--base <ref>` — custom base reference (default: auto-detect)
- `working-tree` — review uncommitted changes only
- `branch` — review all commits on current branch vs base
- `main` — review all commits since diverging from main

If no arguments, auto-detect scope from git state.

## Steps

### Step 1: Determine scope

Run `git status` and `git log --oneline -5` to understand the current state. Determine the review scope from `$ARGUMENTS` or auto-detect.

### Step 2: Launch both reviews in parallel

Run these concurrently:

1. **Claude review**: Use the `pr-review-toolkit:code-reviewer` agent to review the changes. Pass the diff output as context.
2. **Codex review**: Run `/codex:adversarial-review --wait $ARGUMENTS` to get Codex's adversarial findings.

### Step 3: Synthesize

Present a unified report:

```md
## Dual Review Summary

### Agreement (both flagged)
- Issues found by both reviewers (highest confidence)

### Claude-only findings
- Issues only Claude caught

### Codex-only findings
- Issues only Codex caught

### Verdict
- Ship / Needs attention / Block
```

Order findings by severity (critical > high > medium > low). Deduplicate issues that both reviewers found — reference the file:line from each.

### Step 4: Offer next steps

Ask the user:
- Fix all issues now?
- Fix critical/high only?
- Dismiss and ship?
