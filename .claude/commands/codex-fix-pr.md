---
name: codex-fix-pr
description: Delegate PR comment fixes to Codex.
argument-hint: "[PR number]"
---

Gather all unresolved PR review comments, then delegate the fixes to Codex.

## Steps

### Step 1: Gather PR context

Run these in parallel:
- `gh pr view --json number,title,url,headRefName` to get PR info
- `gh api repos/{owner}/{repo}/pulls/{number}/comments` to get review comments
- `gh api graphql` to get review thread resolution status
- `gh api repos/{owner}/{repo}/issues/{number}/comments` to get summary comments (Greptile, etc.)

If `$ARGUMENTS` contains a PR number, use it. Otherwise, use the PR for the current branch.

### Step 2: Filter unresolved comments

Identify all unresolved review threads and any issues from summary comments not covered by inline comments. If everything is resolved, tell the user and stop.

Display a summary table:
| # | Severity | File | Line | Issue |
|---|----------|------|------|-------|

### Step 3: Build fix prompt for Codex

Compose a detailed prompt that includes:
- The PR title and branch name
- Each unresolved comment with: file path, line number, reviewer's feedback, and the surrounding code context
- Project conventions: ESM, strict TypeScript, vitest, Zod validation, Result-style errors

### Step 4: Delegate to Codex

Run `/codex:rescue --wait` with the composed prompt. The prompt should instruct Codex to:
1. Read each referenced file
2. Apply the fix for each comment
3. Run `pnpm typecheck` and `pnpm test` to verify
4. NOT commit — just make the changes

### Step 5: Verify and commit

After Codex finishes:
1. Run `pnpm typecheck && pnpm test` to verify the fixes
2. Review what Codex changed with `git diff`
3. Present the changes to the user for approval
4. On approval: commit, push, reply to each comment with the commit hash, and resolve threads

Follow the project git workflow: commit -> push (no force push, no --no-verify).
