#!/bin/bash
# PostToolUse hook to auto-format TypeScript files after Write/Edit

# Read JSON from stdin
input=$(cat)

# Extract file_path from tool_input
file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')

# If no file_path, try filePath for Write tool
if [ -z "$file_path" ]; then
  file_path=$(echo "$input" | jq -r '.tool_input.filePath // empty')
fi

# Exit if no file path found
if [ -z "$file_path" ]; then
  exit 0
fi

# Only format TypeScript files
if [[ "$file_path" == *.ts ]] || [[ "$file_path" == *.tsx ]]; then
  cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || exit 0
  pnpm exec prettier --write "$file_path" 2>/dev/null
fi

exit 0
