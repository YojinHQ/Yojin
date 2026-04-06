#!/usr/bin/env bash
# ── Yojin Keychain Bridge ────────────────────────────────────────────────────
# Reads the current Claude Code OAuth token from the macOS Keychain and writes
# it to ~/.yojin/.keychain-token so the Docker container can read it without
# needing direct Keychain access.
#
# Installed as a launchd agent by docker-setup.sh. Runs every 4 hours and on
# login. Safe to run manually at any time.
# ────────────────────────────────────────────────────────────────────────────

set -euo pipefail

TOKEN_FILE="${HOME}/.yojin/.keychain-token"
REFRESH_FILE="${HOME}/.yojin/.keychain-refresh-token"

KEYCHAIN_JSON=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null || true)

if [ -z "$KEYCHAIN_JSON" ]; then
  echo "$(date): No Claude Code credentials found in Keychain" >&2
  exit 0
fi

ACCESS_TOKEN=$(echo "$KEYCHAIN_JSON" | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print(d.get('claudeAiOauth',{}).get('accessToken',''))" \
  2>/dev/null || true)

REFRESH_TOKEN=$(echo "$KEYCHAIN_JSON" | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print(d.get('claudeAiOauth',{}).get('refreshToken',''))" \
  2>/dev/null || true)

if [ -z "$ACCESS_TOKEN" ]; then
  echo "$(date): Keychain entry found but no accessToken" >&2
  exit 0
fi

mkdir -p "$(dirname "$TOKEN_FILE")"

# Atomic write — write to a temp file then rename so the container never
# reads a partially-written or truncated token.
TMP_TOKEN="$(mktemp "${TOKEN_FILE}.XXXXXX")"
echo -n "$ACCESS_TOKEN" > "$TMP_TOKEN"
chmod 600 "$TMP_TOKEN"
mv "$TMP_TOKEN" "$TOKEN_FILE"

if [ -n "$REFRESH_TOKEN" ]; then
  TMP_REFRESH="$(mktemp "${REFRESH_FILE}.XXXXXX")"
  echo -n "$REFRESH_TOKEN" > "$TMP_REFRESH"
  chmod 600 "$TMP_REFRESH"
  mv "$TMP_REFRESH" "$REFRESH_FILE"
fi

echo "$(date): Keychain token written to $TOKEN_FILE"
