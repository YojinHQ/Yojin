#!/bin/bash
# PreToolUse hook: intercept git commit and require regression-dog review first.
# Reads the Bash tool_input JSON from stdin. If the command is a git commit,
# checks for a review marker file. If present, allows the commit and clears
# the marker. Otherwise, blocks the commit and asks Claude to run /regression-dog.

MARKER_FILE="/tmp/regression-dog-reviewed.marker"

input=$(cat)
if ! tool_command=$(echo "$input" | jq -r '.tool_input.command // empty' 2>/dev/null); then
  echo "ERROR: regression-dog-gate.sh: jq failed to parse hook input — blocking commit as a precaution." >&2
  exit 2
fi

# Only gate on git commit commands (not git commit --amend which is already reviewed)
if echo "$tool_command" | grep -qE '(^|&&|\|\||;|\()\s*git\s+commit\b' && ! echo "$tool_command" | grep -q -- '--amend'; then
  # If the review marker exists, allow the commit and clear the marker
  if [ -f "$MARKER_FILE" ]; then
    rm -f "$MARKER_FILE"
    exit 0
  fi

  echo "STOP: Before committing, run /regression-dog to review staged changes for regressions. Do not proceed with the commit until the regression review is complete and shared with the user." >&2
  exit 2
fi

exit 0
