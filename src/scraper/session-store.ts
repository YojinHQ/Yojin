/**
 * SessionStore — encrypted browser session persistence.
 *
 * Saves Playwright browser state (cookies, localStorage) to disk,
 * encrypted via the SecretVault. Avoids re-login on every scrape.
 *
 * Storage: data/cache/sessions/{platform}.json (encrypted in vault)
 */

import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { SecretVault } from '../trust/vault/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrowserSessionData {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
  }>;
  localStorage?: Record<string, string>;
  savedAt: string;
}

export interface SessionStoreOptions {
  vault: SecretVault;
  /** Directory for session files — defaults to data/cache/sessions */
  sessionsDir: string;
}

// ---------------------------------------------------------------------------
// SessionStore
// ---------------------------------------------------------------------------

export class SessionStore {
  private readonly vault: SecretVault;
  private readonly sessionsDir: string;

  constructor(opts: SessionStoreOptions) {
    this.vault = opts.vault;
    this.sessionsDir = opts.sessionsDir;
  }

  /** Persist browser session data, encrypted via vault. */
  async save(platform: string, data: BrowserSessionData): Promise<void> {
    const json = JSON.stringify(data);
    const vaultKey = this.vaultKey(platform);
    await this.vault.set(vaultKey, json);

    // Write a marker file so we know a session exists without querying vault
    await mkdir(this.sessionsDir, { recursive: true });
    const markerPath = this.markerPath(platform);
    await writeFile(markerPath, JSON.stringify({ platform, savedAt: data.savedAt }), 'utf-8');
  }

  /** Load saved browser session data, or null if none exists. */
  async load(platform: string): Promise<BrowserSessionData | null> {
    const vaultKey = this.vaultKey(platform);
    const exists = await this.vault.has(vaultKey);
    if (!exists) return null;

    try {
      const json = await this.vault.get(vaultKey);
      return JSON.parse(json) as BrowserSessionData;
    } catch {
      return null;
    }
  }

  /** Remove saved session for a platform. */
  async clear(platform: string): Promise<void> {
    const vaultKey = this.vaultKey(platform);
    const exists = await this.vault.has(vaultKey);
    if (exists) {
      await this.vault.delete(vaultKey);
    }

    // Remove marker file
    try {
      await unlink(this.markerPath(platform));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  /** Check if a session exists for a platform. */
  async has(platform: string): Promise<boolean> {
    return this.vault.has(this.vaultKey(platform));
  }

  private vaultKey(platform: string): string {
    return `SESSION_${platform.toUpperCase()}`;
  }

  private markerPath(platform: string): string {
    return path.join(this.sessionsDir, `${platform.toLowerCase()}.marker.json`);
  }
}
