/**
 * Codex CLI credential reader.
 *
 * Codex stores credentials in `~/.codex/auth.json` by default (file mode),
 * or optionally in the OS keyring (macOS Keychain) when configured.
 *
 * Two auth modes:
 * - `api_key`: contains a standard `OPENAI_API_KEY`
 * - `chatgpt`: contains OAuth JWT tokens (access_token, refresh_token)
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Resolved Codex credential — either an API key or an OAuth access token. */
export interface CodexCredentials {
  /** The token/key to use for OpenAI API authentication (Bearer header). */
  accessToken: string;
  /** Whether this is a ChatGPT OAuth token or a standard API key. */
  authMode: 'api_key' | 'chatgpt';
}

// ---------------------------------------------------------------------------
// auth.json structure
// ---------------------------------------------------------------------------

interface AuthDotJson {
  auth_mode?: 'api_key' | 'chatgpt';
  OPENAI_API_KEY?: string;
  tokens?: {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
  };
  last_refresh?: string;
}

// ---------------------------------------------------------------------------
// File-based credential reader
// ---------------------------------------------------------------------------

function codexHome(): string {
  return process.env.CODEX_HOME || join(homedir(), '.codex');
}

/**
 * Read credentials from `~/.codex/auth.json` (the default storage mode).
 */
async function readAuthFile(): Promise<CodexCredentials | null> {
  try {
    const authPath = join(codexHome(), 'auth.json');
    const raw = await readFile(authPath, 'utf-8');
    const auth: AuthDotJson = JSON.parse(raw);

    if (auth.auth_mode === 'api_key' && auth.OPENAI_API_KEY) {
      return { accessToken: auth.OPENAI_API_KEY, authMode: 'api_key' };
    }

    if (auth.auth_mode === 'chatgpt' && auth.tokens?.access_token) {
      return { accessToken: auth.tokens.access_token, authMode: 'chatgpt' };
    }

    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// macOS Keychain reader (opt-in via config.toml)
// ---------------------------------------------------------------------------

/**
 * Attempt to read Codex credentials from macOS Keychain.
 *
 * Codex uses the Rust `keyring` crate with service name "Codex Auth" and
 * an account key derived from SHA-256 of the CODEX_HOME path. Since we
 * can't easily replicate the exact account key, we search by service name.
 */
async function readKeychainEntry(): Promise<CodexCredentials | null> {
  if (platform() !== 'darwin') return null;
  try {
    const { stdout } = await execFileAsync('security', ['find-generic-password', '-s', 'Codex Auth', '-w'], {
      encoding: 'utf8',
      timeout: 3000,
    });
    const auth: AuthDotJson = JSON.parse(stdout.trim());

    if (auth.auth_mode === 'api_key' && auth.OPENAI_API_KEY) {
      return { accessToken: auth.OPENAI_API_KEY, authMode: 'api_key' };
    }

    if (auth.auth_mode === 'chatgpt' && auth.tokens?.access_token) {
      return { accessToken: auth.tokens.access_token, authMode: 'chatgpt' };
    }

    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read Codex CLI credentials from the machine.
 *
 * Priority:
 * 1. `CODEX_API_KEY` env var (highest, same as Codex CLI)
 * 2. `~/.codex/auth.json` file (default storage)
 * 3. macOS Keychain with service "Codex Auth" (opt-in storage)
 */
export async function readCodexCredentials(): Promise<CodexCredentials | null> {
  // 1. Env var takes highest priority (matches Codex CLI behavior)
  if (process.env.CODEX_API_KEY) {
    return { accessToken: process.env.CODEX_API_KEY, authMode: 'api_key' };
  }

  // 2. File-based storage (default)
  const fromFile = await readAuthFile();
  if (fromFile) return fromFile;

  // 3. Keychain (opt-in via config.toml)
  return readKeychainEntry();
}
