# Test File Command

Run tests related to the specified file or current context.

## Usage
```
/test-file [path]
```

## Behavior

If a path is provided:
1. Find test files matching the path pattern
2. Run vitest with the matching test files

If no path is provided:
1. Look at recently modified files
2. Find associated test files
3. Run relevant tests

## Example

```
/test-file src/enrichment/enrichment-pipeline.ts
```

This will run: `pnpm test -- --reporter=verbose enrichment-pipeline`

## Implementation

If `$ARGUMENTS` is provided, run:
```bash
pnpm test -- --reporter=verbose $ARGUMENTS
```

Otherwise, suggest the user specify a file path.
