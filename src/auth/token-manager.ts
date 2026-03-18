/**
 * OAuth token manager with auto-refresh.
 *
 * Holds the current access token in memory and refreshes it automatically
 * when a 401 is detected. Persists the new tokens back to `.env`.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { refreshClaudeOAuthToken } from './claude-oauth.js';

const ENV_PATH = resolve(process.cwd(), '.env');

export class TokenManager {
  private accessToken: string | undefined;
  private refreshToken: string | undefined;
  private refreshing: Promise<string> | null = null;

  constructor() {
    this.accessToken = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim() || undefined;
    this.refreshToken = process.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN?.trim() || undefined;
  }

  getAccessToken(): string | undefined {
    return this.accessToken;
  }

  hasRefreshToken(): boolean {
    return !!this.refreshToken;
  }

  /**
   * Refresh the access token. Deduplicates concurrent refresh attempts.
   * Returns the new access token, or throws if refresh fails.
   */
  async refresh(): Promise<string> {
    if (!this.refreshToken) {
      throw new Error('No refresh token available. Run `pnpm setup-token` to re-authenticate.');
    }

    // Deduplicate concurrent refreshes
    if (this.refreshing) return this.refreshing;

    this.refreshing = this.doRefresh();
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = null;
    }
  }

  private async doRefresh(): Promise<string> {
    // refreshToken is guaranteed non-null — checked in refresh() before calling doRefresh()
    const result = await refreshClaudeOAuthToken(this.refreshToken as string);

    this.accessToken = result.accessToken;
    if (result.refreshToken) {
      this.refreshToken = result.refreshToken;
    }

    // Update process.env so the claude CLI picks up the new token
    process.env.CLAUDE_CODE_OAUTH_TOKEN = this.accessToken;
    if (result.refreshToken) {
      process.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN = result.refreshToken;
    }

    // Persist to .env file
    await this.persistToEnv(this.accessToken, this.refreshToken);

    return this.accessToken;
  }

  private async persistToEnv(accessToken: string, refreshToken: string | undefined): Promise<void> {
    try {
      let content = await readFile(ENV_PATH, 'utf-8');

      content = upsertEnvVar(content, 'CLAUDE_CODE_OAUTH_TOKEN', accessToken);
      if (refreshToken) {
        content = upsertEnvVar(content, 'CLAUDE_CODE_OAUTH_REFRESH_TOKEN', refreshToken);
      }

      await writeFile(ENV_PATH, content, 'utf-8');
    } catch {
      // Non-fatal — tokens are already in process.env
    }
  }
}

/**
 * Replace an existing env var line or append it.
 */
function upsertEnvVar(content: string, key: string, value: string): string {
  const regex = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value}`;

  if (regex.test(content)) {
    return content.replace(regex, line);
  }

  // Append with a newline if needed
  const separator = content.endsWith('\n') ? '' : '\n';
  return content + separator + line + '\n';
}

/** Singleton instance */
let _instance: TokenManager | undefined;

export function getTokenManager(): TokenManager {
  if (!_instance) {
    _instance = new TokenManager();
  }
  return _instance;
}
