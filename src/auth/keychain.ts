/**
 * macOS Keychain integration for reading Claude Code OAuth tokens.
 *
 * Claude Code CLI stores its OAuth credentials in the macOS Keychain under
 * the service name "Claude Code-credentials". This module provides a shared
 * utility to read those tokens so multiple parts of the codebase can reuse
 * the same logic (onboarding detection, provider initialization, etc.).
 */

import { execFile } from 'node:child_process';
import { platform } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const KEYCHAIN_SERVICE = 'Claude Code-credentials';

/** Detect OAuth tokens by prefix. */
function isOAuthToken(token: string): boolean {
  return token.startsWith('sk-ant-oat');
}

interface KeychainCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

/**
 * Read the full Claude Code OAuth credential entry from macOS Keychain.
 * Returns both access and refresh tokens, or null if not found.
 */
async function readKeychainEntry(): Promise<KeychainCredentials | null> {
  if (platform() !== 'darwin') return null;
  try {
    const { stdout } = await execFileAsync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], {
      encoding: 'utf8',
      timeout: 3000,
    });
    const parsed = JSON.parse(stdout.trim()) as {
      claudeAiOauth?: { accessToken?: string; refreshToken?: string; expiresAt?: number };
    };
    const entry = parsed.claudeAiOauth;
    if (!entry?.accessToken || !isOAuthToken(entry.accessToken)) return null;
    return {
      accessToken: entry.accessToken,
      refreshToken: entry.refreshToken,
      expiresAt: entry.expiresAt,
    };
  } catch {
    return null;
  }
}

/**
 * Attempt to read the Claude Code OAuth token from macOS Keychain.
 *
 * Returns the access token string on success, or null if:
 * - Not running on macOS
 * - Keychain entry doesn't exist
 * - Entry doesn't contain a valid OAuth token
 */
export async function readTokenFromKeychain(): Promise<string | null> {
  const entry = await readKeychainEntry();
  return entry?.accessToken ?? null;
}

/**
 * Read the refresh token from macOS Keychain (for token renewal).
 */
export async function readRefreshTokenFromKeychain(): Promise<string | null> {
  const entry = await readKeychainEntry();
  return entry?.refreshToken ?? null;
}
