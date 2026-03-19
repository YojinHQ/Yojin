/**
 * ConnectionManager — orchestrates platform onboarding.
 *
 * Manages the full lifecycle of a platform connection: tier detection,
 * credential storage, connector validation, config/state persistence,
 * and pubsub event publishing.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { type CredentialLookup, getCredentialRequirements } from './platform-credentials.js';
import {
  type Connection,
  type ConnectionEvent,
  type ConnectionResult,
  type ConnectionStateFile,
  ConnectionStateFileSchema,
  type ConnectionStatus,
  type ConnectionsFile,
  ConnectionsFileSchema,
  type IntegrationTier,
  type PlatformConnector,
  type PlatformConnectorResult,
  type TierAvailability,
} from './types.js';
import type { Platform } from '../api/graphql/types.js';
import type { SecretVault } from '../trust/vault/types.js';

// ---------------------------------------------------------------------------
// Tier priority order (most capable → least capable)
// ---------------------------------------------------------------------------

const TIER_PRIORITY: IntegrationTier[] = ['CLI', 'API', 'UI', 'SCREENSHOT'];

// ---------------------------------------------------------------------------
// Extended connector interface
// ---------------------------------------------------------------------------

export interface TieredPlatformConnector extends PlatformConnector {
  tier: IntegrationTier;
  isAvailable(): Promise<boolean>;
  connect(credentialRefs: string[]): Promise<{ success: boolean; error?: string }>;
  disconnect(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ConnectionManagerOptions {
  vault: SecretVault;
  pubsub: { publish(channel: string, payload: unknown): void };
  auditLog: { append(event: Record<string, unknown>): void };
  /** Path to config file — data/config/connections.json */
  configPath: string;
  /** Path to state file — data/cache/connection-state.json */
  statePath: string;
  /** Custom credential lookup (supports config overrides). Falls back to hardcoded defaults. */
  credentialLookup?: CredentialLookup;
}

export interface ConnectPlatformOptions {
  platform: Platform;
  /** Auto-detects best available tier when omitted. */
  tier?: IntegrationTier;
  /** key → plaintext value pairs to store in vault */
  credentials?: Record<string, string>;
}

export interface DisconnectPlatformOptions {
  removeCredentials?: boolean;
}

// ---------------------------------------------------------------------------
// ConnectionManager
// ---------------------------------------------------------------------------

export class ConnectionManager {
  private readonly connectors = new Map<string, TieredPlatformConnector>();
  /** In-progress platforms — prevents concurrent connect/disconnect attempts */
  private readonly inProgress = new Set<string>();

  private readonly vault: SecretVault;
  private readonly pubsub: { publish(channel: string, payload: unknown): void };
  private readonly auditLog: { append(event: Record<string, unknown>): void };
  private readonly configPath: string;
  private readonly statePath: string;
  private readonly credentialLookup: CredentialLookup;

  /** Async mutex for serializing config/state file I/O */
  private ioQueue: Promise<void> = Promise.resolve();

  constructor(opts: ConnectionManagerOptions) {
    this.vault = opts.vault;
    this.pubsub = opts.pubsub;
    this.auditLog = opts.auditLog;
    this.configPath = opts.configPath;
    this.statePath = opts.statePath;
    this.credentialLookup = opts.credentialLookup ?? getCredentialRequirements;
  }

  // -------------------------------------------------------------------------
  // I/O mutex
  // -------------------------------------------------------------------------

  private withIoLock<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.ioQueue.then(fn, fn);
    this.ioQueue = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  registerConnector(connector: TieredPlatformConnector): void {
    const key = `${connector.platformId}:${connector.tier}`;
    this.connectors.set(key, connector);
  }

  // -------------------------------------------------------------------------
  // Tier detection
  // -------------------------------------------------------------------------

  async detectAvailableTiers(platform: Platform): Promise<TierAvailability[]> {
    const results: TierAvailability[] = [];

    for (const tier of TIER_PRIORITY) {
      const key = `${platform}:${tier}`;
      const connector = this.connectors.get(key);
      const available = connector ? await connector.isAvailable() : false;
      const requiresCredentials = this.credentialLookup(platform, tier);

      results.push({ tier, available, requiresCredentials });
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Connect
  // -------------------------------------------------------------------------

  async connectPlatform(opts: ConnectPlatformOptions): Promise<ConnectionResult> {
    const { platform, credentials } = opts;
    const channel = `connectionStatus:${platform}`;

    // Concurrency guard
    if (this.inProgress.has(platform)) {
      return { success: false, error: `Connection attempt already in progress for ${platform}` };
    }
    this.inProgress.add(platform);

    try {
      // Auto-detect tier if not provided
      const tier = opts.tier ?? (await this.detectBestTier(platform));
      if (!tier) {
        return { success: false, error: `No available integration tier for ${platform}` };
      }

      if (!opts.tier) {
        this.publish(channel, {
          platform,
          step: 'TIER_DETECTED',
          message: `Auto-detected best tier: ${tier}`,
          tier,
        });
      }

      this.auditLog.append({ type: 'connection.attempt', platform, tier, timestamp: new Date().toISOString() });

      // Store credentials in vault
      const credentialRefs: string[] = [];
      if (credentials && Object.keys(credentials).length > 0) {
        for (const [suffix, value] of Object.entries(credentials)) {
          const vaultKey = `${platform}_${suffix}`;
          await this.vault.set(vaultKey, value);
          credentialRefs.push(vaultKey);
        }

        this.publish(channel, {
          platform,
          step: 'CREDENTIALS_STORED',
          message: `Stored ${credentialRefs.length} credential(s) for ${platform}`,
        });
      }

      // Resolve connector
      const key = `${platform}:${tier}`;
      const connector = this.connectors.get(key);
      if (!connector) {
        await this.rollbackCredentials(credentialRefs);
        return this.failConnection(channel, platform, tier, `No connector registered for ${platform}:${tier}`);
      }

      // Validate connection
      this.publish(channel, {
        platform,
        step: 'VALIDATING',
        message: `Validating ${platform} via ${tier}`,
        tier,
      });

      let connectResult: { success: boolean; error?: string };
      try {
        connectResult = await connector.connect(credentialRefs);
      } catch (err) {
        await this.rollbackCredentials(credentialRefs);
        return this.failConnection(channel, platform, tier, err instanceof Error ? err.message : 'Connection failed');
      }

      if (!connectResult.success) {
        await this.rollbackCredentials(credentialRefs);
        return this.failConnection(channel, platform, tier, connectResult.error ?? 'Connection failed');
      }

      // Test scrape
      let fetchResult: PlatformConnectorResult;
      try {
        fetchResult = await connector.fetchPositions();
      } catch (err) {
        await this.rollbackCredentials(credentialRefs);
        return this.failConnection(
          channel,
          platform,
          tier,
          err instanceof Error ? err.message : 'Position fetch failed',
        );
      }

      if (!fetchResult.success) {
        await this.rollbackCredentials(credentialRefs);
        return this.failConnection(channel, platform, tier, fetchResult.error);
      }

      // Persist config + state
      const now = new Date().toISOString();
      await this.upsertConfig({ platform, tier, credentialRefs, syncInterval: 3600, autoRefresh: true });
      await this.upsertState({ platform, tier, status: 'CONNECTED', lastSync: now, lastError: null });

      this.auditLog.append({ type: 'connection.success', platform, tier, timestamp: now });
      this.publish(channel, {
        platform,
        step: 'CONNECTED',
        message: `${platform} connected via ${tier}`,
        tier,
      });

      const connection: Connection = {
        platform,
        tier,
        status: 'CONNECTED',
        lastSync: now,
        lastError: null,
        syncInterval: 3600,
        autoRefresh: true,
      };

      return { success: true, connection };
    } finally {
      this.inProgress.delete(platform);
    }
  }

  // -------------------------------------------------------------------------
  // Disconnect
  // -------------------------------------------------------------------------

  async disconnectPlatform(platform: Platform, opts: DisconnectPlatformOptions = {}): Promise<ConnectionResult> {
    const { removeCredentials = false } = opts;

    // Concurrency guard
    if (this.inProgress.has(platform)) {
      return { success: false, error: `Operation already in progress for ${platform}` };
    }
    this.inProgress.add(platform);

    try {
      // Check if platform exists in config or state
      const configs = await this.readConfig();
      const states = await this.readState();
      const configEntry = configs.find((c) => c.platform === platform);
      const stateEntry = states.find((s) => s.platform === platform);

      if (!configEntry && !stateEntry) {
        return { success: false, error: `${platform} is not connected` };
      }

      // Resolve connector and call disconnect()
      const tier = configEntry?.tier ?? stateEntry?.tier ?? ('SCREENSHOT' as IntegrationTier);
      const connectorKey = `${platform}:${tier}`;
      const connector = this.connectors.get(connectorKey);
      if (connector) {
        await connector.disconnect();
      }

      // Remove from config and update state — serialized via I/O lock
      await this.withIoLock(async () => {
        const currentConfigs = await this.readConfig();
        const filtered = currentConfigs.filter((c) => c.platform !== platform);
        await this.writeConfig(filtered);

        const currentStates = await this.readState();
        const filteredStates = currentStates.filter((s) => s.platform !== platform);
        filteredStates.push({ platform, tier, status: 'DISCONNECTED', lastSync: null, lastError: null });
        await this.writeState(filteredStates);
      });

      // Optionally remove credentials
      if (removeCredentials) {
        const keys = await this.vault.list();
        const prefix = `${platform}_`;
        for (const key of keys) {
          if (key.startsWith(prefix)) {
            await this.vault.delete(key);
          }
        }
      }

      this.auditLog.append({
        type: 'connection.removed',
        platform,
        removeCredentials,
        timestamp: new Date().toISOString(),
      });

      this.publish(`connectionStatus:${platform}`, {
        platform,
        step: 'DISCONNECTED' as ConnectionEvent['step'],
        message: `${platform} disconnected`,
      });

      return { success: true };
    } finally {
      this.inProgress.delete(platform);
    }
  }

  // -------------------------------------------------------------------------
  // List connections
  // -------------------------------------------------------------------------

  async listConnections(): Promise<Connection[]> {
    return this.withIoLock(async () => {
      const configs = await this.readConfig();
      const states = await this.readState();

      const stateMap = new Map(states.map((s) => [s.platform, s]));
      const seenPlatforms = new Set<string>();
      const connections: Connection[] = [];

      // Map configs first (connected platforms)
      for (const c of configs) {
        seenPlatforms.add(c.platform);
        const s = stateMap.get(c.platform);
        connections.push({
          platform: c.platform,
          tier: c.tier,
          status: s?.status ?? 'PENDING',
          lastSync: s?.lastSync ?? null,
          lastError: s?.lastError ?? null,
          syncInterval: c.syncInterval,
          autoRefresh: c.autoRefresh,
        });
      }

      // Include state entries without matching config (disconnected/errored)
      for (const s of states) {
        if (!seenPlatforms.has(s.platform)) {
          connections.push({
            platform: s.platform as Platform,
            tier: s.tier as IntegrationTier,
            status: s.status as ConnectionStatus,
            lastSync: s.lastSync ?? null,
            lastError: s.lastError ?? null,
            syncInterval: 0,
            autoRefresh: false,
          });
        }
      }

      return connections;
    });
  }

  // -------------------------------------------------------------------------
  // Auto-detection
  // -------------------------------------------------------------------------

  private async detectBestTier(platform: Platform): Promise<IntegrationTier | null> {
    const tiers = await this.detectAvailableTiers(platform);
    const best = tiers.find((t) => t.available);
    return best?.tier ?? null;
  }

  // -------------------------------------------------------------------------
  // Config I/O
  // -------------------------------------------------------------------------

  private async readConfig() {
    try {
      const raw = await readFile(this.configPath, 'utf-8');
      return ConnectionsFileSchema.parse(JSON.parse(raw));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
      return [];
    }
  }

  private async writeConfig(data: ConnectionsFile): Promise<void> {
    await mkdir(path.dirname(this.configPath), { recursive: true });
    await writeFile(this.configPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private async upsertConfig(entry: {
    platform: Platform;
    tier: IntegrationTier;
    credentialRefs: string[];
    syncInterval: number;
    autoRefresh: boolean;
  }): Promise<void> {
    await this.withIoLock(async () => {
      const configs = await this.readConfig();
      const filtered = configs.filter((c) => c.platform !== entry.platform);
      filtered.push(entry);
      await this.writeConfig(filtered);
    });
  }

  // -------------------------------------------------------------------------
  // State I/O
  // -------------------------------------------------------------------------

  private async readState() {
    try {
      const raw = await readFile(this.statePath, 'utf-8');
      return ConnectionStateFileSchema.parse(JSON.parse(raw));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
      return [];
    }
  }

  private async writeState(data: ConnectionStateFile): Promise<void> {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    await writeFile(this.statePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private async upsertState(entry: {
    platform: Platform;
    tier: IntegrationTier;
    status: ConnectionStatus;
    lastSync: string | null;
    lastError: string | null;
  }): Promise<void> {
    await this.withIoLock(async () => {
      const states = await this.readState();
      const filtered = states.filter((s) => s.platform !== entry.platform);
      filtered.push(entry);
      await this.writeState(filtered);
    });
  }

  // -------------------------------------------------------------------------
  // Error + Pubsub helpers
  // -------------------------------------------------------------------------

  private async failConnection(
    channel: string,
    platform: Platform,
    tier: IntegrationTier,
    error: string,
  ): Promise<ConnectionResult> {
    await this.upsertState({ platform, tier, status: 'ERROR', lastSync: null, lastError: error });
    this.auditLog.append({ type: 'connection.failure', platform, tier, error, timestamp: new Date().toISOString() });
    this.publish(channel, { platform, step: 'ERROR', message: error, error });
    return { success: false, error };
  }

  /** Remove stored credentials on connection failure rollback */
  private async rollbackCredentials(credentialRefs: string[]): Promise<void> {
    for (const ref of credentialRefs) {
      try {
        await this.vault.delete(ref);
      } catch (err) {
        this.auditLog.append({
          type: 'credential.rollback_failed',
          key: ref,
          error: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  private publish(
    channel: string,
    event: {
      platform: Platform;
      step: ConnectionEvent['step'];
      message: string;
      tier?: IntegrationTier;
      error?: string;
    },
  ): void {
    this.pubsub.publish(channel, event);
  }
}
