---
description: Git workflow and PR creation rules
globs: ["**/*"]
---

# Git Workflow

## Commit → Push → PR

Every commit MUST be followed by push and PR creation. This is one atomic operation.

```bash
# 1. Commit changes
git add <specific-files> && git commit -m "feat: description"

# 2. Pull and merge safety check
git fetch origin && git pull origin main --no-rebase

# 3. Push to remote
git push origin <branch-name>

# 4. Create PR immediately
gh pr create --title "<type>: <description>" --body "<summary>"
```

## Branch Naming

```
feat/<short-description>     # New features
fix/<short-description>      # Bug fixes
refactor/<short-description> # Code restructuring
```

## Commit Message Format

```
<type>: <brief description>

Types: feat, fix, refactor, test, docs, chore
```

## Git Hooks (Husky)

Enforced automatically via `.husky/`:
- **pre-commit**: Runs `lint-staged` (Prettier formatting), `tsc --noEmit` (typecheck), and strict version pinning check
- **pre-push**: Runs `format:check`, `typecheck`, `lint`, `test:ci`

These hooks are installed automatically via `pnpm install` (the `prepare` script runs `husky`).

## Never

- `git push --force` without user approval
- `git reset --hard` on shared branches
- Skip conflict resolution
- Use `--no-verify` to skip hooks
- Commit `.env`, `data/cache/`, or browser session files
