# Fix PR Comments

Review and fix all open PR comments on the current branch, then verify CI.

## Usage
```
/fix-pr
```

## Behavior

### Step 1: Gather context
Run these in parallel:
- `gh pr view --json number,title,url,state,statusCheckRollup` to get PR info and CI status
- `gh pr view --json number --jq '.number'` then `gh api repos/{owner}/{repo}/pulls/{number}/comments` to get all review comments
- `gh api graphql` query to get review thread IDs and resolution status

### Step 2: Identify unresolved comments
Filter for unresolved review threads. If all threads are already resolved, skip to Step 5. Display a summary table of comments with severity, file, line, and issue description.

### Step 3: Fix each comment
For each unresolved comment:
1. Read the referenced file
2. Understand the issue described in the comment
3. Apply the fix
4. If the fix requires test changes, update tests too

### Step 4: Commit, push, reply, resolve
1. Run `pnpm test` and `pnpm typecheck` to verify fixes
2. Commit all changes with message: `fix: address PR #{number} review comments`
3. Push to the current branch
4. Reply to each fixed comment with the commit hash and brief description
5. Resolve all addressed review threads via GraphQL `resolveReviewThread` mutation

### Step 5: Check CI
1. Wait a few seconds for CI to pick up the new push
2. Run `gh pr checks` or `gh run list` to show current CI status
3. If CI is failing, check the logs with `gh run view --log-failed`
4. Report CI status to the user

### Step 6: Self-improve rules
After all comments are resolved, analyze the patterns across the fixed comments and update `.claude/rules/` to prevent the same class of issues in future PRs.

1. **Categorize** each fixed comment by root cause (e.g. type-runtime mismatch, missing redaction field, error handling gap, dead code, missing test assertion)
2. **Check existing rules** — read the relevant `.claude/rules/*.md` files to see if a rule already covers this pattern
3. **Add or update rules** only when:
   - The same pattern appeared 2+ times across comments, OR
   - The issue is non-obvious (a reasonable dev would make the same mistake)
   - The rule is general enough to apply beyond this specific PR
4. **Skip rule updates** when:
   - The fix was a one-off typo or simple oversight
   - An existing rule already covers it (the issue was just missed, not undocumented)
   - The pattern is too specific to generalize
5. **Commit** rule changes in a separate commit: `docs: add rules to prevent recurring PR review findings`

Rules should be concise, actionable, and explain _why_ (not just _what_). Example:
```
- **Types must match runtime shape.** If a field is stripped at runtime, `Omit` it from the type. Never use `as unknown as T` to hide a mismatch.
```

## Notes
- Always read files before editing them
- Run typecheck and tests before committing
- Follow the project's git workflow: commit -> push (no force push)
- Reply to each comment individually with the commit hash
