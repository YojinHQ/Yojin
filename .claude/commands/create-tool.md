# Create Tool Command

Scaffold a new agent tool with the standard project structure.

## Usage
```
/create-tool <tool-name>
```

## What Gets Created

A new tool file in `src/tools/` that follows the ToolRegistry registration pattern.

## Implementation

When invoked with `$ARGUMENTS`:

1. Validate the tool name (kebab-case)
2. Create the tool file at `src/tools/<tool-name>.ts`
3. Follow the pattern:
   - Export a tool definition with `name`, `description`, `inputSchema` (Zod), and `execute` function
   - Use `YojinContext` for accessing dependencies
   - Return structured results, not raw strings
4. Register the tool in the appropriate agent profile's tool list
5. Add the tool to `src/research/adapter.ts` or the relevant adapter

The tool name from the command is: $ARGUMENTS
