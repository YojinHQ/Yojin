# Create Guard Command

Scaffold a new guard for the guard pipeline.

## Usage
```
/create-guard <guard-name>
```

## What Gets Created

A new guard file in `src/guards/` implementing the `Guard` interface.

## Implementation

When invoked with `$ARGUMENTS`:

1. Validate the guard name (kebab-case)
2. Create the guard file at `src/guards/<guard-name>.ts`
3. Follow the pattern:
   - Implement the `Guard` interface: `{ name: string; check(action: ProposedAction): GuardResult }`
   - Return `{ pass: true }` or `{ pass: false, reason: string }`
   - Guards are generic safety checks — no finance-specific logic
   - Load config from `data/config/` if needed
4. Register in `src/guards/registry.ts`
5. Add a test file in `test/guards/<guard-name>.test.ts`

The guard name from the command is: $ARGUMENTS
