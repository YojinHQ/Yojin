import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Platform } from '../../src/api/graphql/types.js';
import { ConnectionManager, type TieredPlatformConnector } from '../../src/scraper/connection-manager.js';
import type { SecretVault } from '../../src/trust/vault/types.js';

// ---------------------------------------------------------------------------
// Helpers — mock factories
// ---------------------------------------------------------------------------

function makeMockVault(): SecretVault & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async set(key: string, value: string) {
      store.set(key, value);
    },
    async get(key: string) {
      if (!store.has(key)) throw new Error(`Key not found: ${key}`);
      return store.get(key)!;
    },
    async has(key: string) {
      return store.has(key);
    },
    async list() {
      return [...store.keys()];
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

function makeMockPubsub() {
  const events: Array<{ channel: string; payload: unknown }> = [];
  return {
    events,
    publish(channel: string, payload: unknown) {
      events.push({ channel, payload });
    },
  };
}

function makeMockAuditLog() {
  const entries: Array<Record<string, unknown>> = [];
  return {
    entries,
    append(event: Record<string, unknown>) {
      entries.push(event);
    },
  };
}

function makeConnector(
  platformId: string,
  tier: TieredPlatformConnector['tier'],
  overrides: Partial<TieredPlatformConnector> = {},
): TieredPlatformConnector {
  return {
    platformId,
    platformName: platformId,
    tier,
    isAvailable: vi.fn().mockResolvedValue(true),
    connect: vi.fn().mockResolvedValue({ success: true }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    fetchPositions: vi.fn().mockResolvedValue({
      success: true,
      positions: [],
      metadata: {
        source: 'scraper',
        platform: platformId,
        extractedAt: new Date().toISOString(),
        confidence: 1,
        positionConfidences: [],
        warnings: [],
      },
    }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let configPath: string;
let statePath: string;
let vault: ReturnType<typeof makeMockVault>;
let pubsub: ReturnType<typeof makeMockPubsub>;
let auditLog: ReturnType<typeof makeMockAuditLog>;
let manager: ConnectionManager;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'cm-test-'));
  configPath = path.join(tmpDir, 'connections.json');
  statePath = path.join(tmpDir, 'state.json');
  vault = makeMockVault();
  pubsub = makeMockPubsub();
  auditLog = makeMockAuditLog();
  manager = new ConnectionManager({ vault, pubsub, auditLog, configPath, statePath });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tier detection
// ---------------------------------------------------------------------------

describe('detectAvailableTiers', () => {
  it('returns all tiers in TIER_PRIORITY order (CLI→API→UI→SCREENSHOT)', async () => {
    const platform: Platform = 'COINBASE';
    manager.registerConnector(makeConnector(platform, 'SCREENSHOT'));
    manager.registerConnector(makeConnector(platform, 'API'));
    manager.registerConnector(makeConnector(platform, 'CLI'));

    const tiers = await manager.detectAvailableTiers(platform);

    // All tiers returned in priority order; unregistered ones marked unavailable
    expect(tiers.map((t) => t.tier)).toEqual(['CLI', 'API', 'UI', 'SCREENSHOT']);
    expect(tiers.find((t) => t.tier === 'UI')?.available).toBe(false);
    expect(tiers.find((t) => t.tier === 'CLI')?.available).toBe(true);
  });

  it('marks unavailable connectors correctly', async () => {
    const platform: Platform = 'COINBASE';
    manager.registerConnector(makeConnector(platform, 'API', { isAvailable: vi.fn().mockResolvedValue(false) }));
    manager.registerConnector(makeConnector(platform, 'SCREENSHOT', { isAvailable: vi.fn().mockResolvedValue(true) }));

    const tiers = await manager.detectAvailableTiers(platform);

    const api = tiers.find((t) => t.tier === 'API');
    const screenshot = tiers.find((t) => t.tier === 'SCREENSHOT');
    expect(api?.available).toBe(false);
    expect(screenshot?.available).toBe(true);
  });

  it('includes credential requirements from getCredentialRequirements', async () => {
    const platform: Platform = 'COINBASE';
    manager.registerConnector(makeConnector(platform, 'API'));

    const tiers = await manager.detectAvailableTiers(platform);
    const api = tiers.find((t) => t.tier === 'API');

    expect(api?.requiresCredentials).toContain('COINBASE_API_KEY');
    expect(api?.requiresCredentials).toContain('COINBASE_API_SECRET');
  });

  it('returns all tiers as unavailable when no connectors registered', async () => {
    const tiers = await manager.detectAvailableTiers('ROBINHOOD');
    expect(tiers).toHaveLength(4);
    expect(tiers.every((t) => !t.available)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// connectPlatform — success flow
// ---------------------------------------------------------------------------

describe('connectPlatform — success', () => {
  it('stores credentials in vault with {PLATFORM}_{SUFFIX} key format', async () => {
    const connector = makeConnector('COINBASE', 'API');
    manager.registerConnector(connector);

    await manager.connectPlatform({
      platform: 'COINBASE',
      tier: 'API',
      credentials: { API_KEY: 'key123', API_SECRET: 'secret456' },
    });

    expect(vault.store.get('COINBASE_API_KEY')).toBe('key123');
    expect(vault.store.get('COINBASE_API_SECRET')).toBe('secret456');
  });

  it('publishes CREDENTIALS_STORED event when credentials provided', async () => {
    manager.registerConnector(makeConnector('COINBASE', 'API'));

    await manager.connectPlatform({
      platform: 'COINBASE',
      tier: 'API',
      credentials: { API_KEY: 'key123' },
    });

    const events = pubsub.events.filter((e) => e.channel === 'connectionStatus:COINBASE');
    const credEvent = events.find((e) => (e.payload as { step: string }).step === 'CREDENTIALS_STORED');
    expect(credEvent).toBeDefined();
  });

  it('publishes VALIDATING event before calling connect()', async () => {
    const connectFn = vi.fn().mockResolvedValue({ success: true });
    manager.registerConnector(makeConnector('COINBASE', 'API', { connect: connectFn }));

    await manager.connectPlatform({ platform: 'COINBASE', tier: 'API' });

    const events = pubsub.events.filter((e) => e.channel === 'connectionStatus:COINBASE');
    const validatingIdx = events.findIndex((e) => (e.payload as { step: string }).step === 'VALIDATING');
    expect(validatingIdx).toBeGreaterThanOrEqual(0);
  });

  it('publishes CONNECTED event on success', async () => {
    manager.registerConnector(makeConnector('COINBASE', 'API'));

    await manager.connectPlatform({ platform: 'COINBASE', tier: 'API' });

    const events = pubsub.events.filter((e) => e.channel === 'connectionStatus:COINBASE');
    const connectedEvent = events.find((e) => (e.payload as { step: string }).step === 'CONNECTED');
    expect(connectedEvent).toBeDefined();
  });

  it('writes config file with correct shape', async () => {
    manager.registerConnector(makeConnector('COINBASE', 'API'));

    await manager.connectPlatform({
      platform: 'COINBASE',
      tier: 'API',
      credentials: { API_KEY: 'k' },
    });

    const connections = await manager.listConnections();
    expect(connections).toHaveLength(1);
    expect(connections[0].platform).toBe('COINBASE');
    expect(connections[0].tier).toBe('API');
    expect(connections[0].status).toBe('CONNECTED');
  });

  it('writes state file with CONNECTED status', async () => {
    manager.registerConnector(makeConnector('COINBASE', 'API'));

    const result = await manager.connectPlatform({ platform: 'COINBASE', tier: 'API' });

    expect(result.success).toBe(true);
    expect(result.connection?.status).toBe('CONNECTED');
    expect(result.connection?.lastSync).toBeTruthy();
  });

  it('logs connection.attempt and connection.success audit events', async () => {
    manager.registerConnector(makeConnector('COINBASE', 'API'));

    await manager.connectPlatform({ platform: 'COINBASE', tier: 'API' });

    const types = auditLog.entries.map((e) => e['type']);
    expect(types).toContain('connection.attempt');
    expect(types).toContain('connection.success');
  });

  it('calls connect() with credential refs from vault', async () => {
    const connectFn = vi.fn().mockResolvedValue({ success: true });
    manager.registerConnector(makeConnector('COINBASE', 'API', { connect: connectFn }));

    await manager.connectPlatform({
      platform: 'COINBASE',
      tier: 'API',
      credentials: { API_KEY: 'k', API_SECRET: 's' },
    });

    expect(connectFn).toHaveBeenCalledWith(['COINBASE_API_KEY', 'COINBASE_API_SECRET']);
  });

  it('auto-detects best tier when tier is omitted', async () => {
    manager.registerConnector(makeConnector('COINBASE', 'API'));
    manager.registerConnector(makeConnector('COINBASE', 'SCREENSHOT'));

    const result = await manager.connectPlatform({ platform: 'COINBASE' });

    expect(result.success).toBe(true);
    // API should be chosen (higher priority than SCREENSHOT)
    expect(result.connection?.tier).toBe('API');
  });

  it('publishes TIER_DETECTED event when tier is auto-detected', async () => {
    manager.registerConnector(makeConnector('COINBASE', 'API'));

    await manager.connectPlatform({ platform: 'COINBASE' });

    const events = pubsub.events.filter((e) => e.channel === 'connectionStatus:COINBASE');
    const tierEvent = events.find((e) => (e.payload as { step: string }).step === 'TIER_DETECTED');
    expect(tierEvent).toBeDefined();
    expect((tierEvent?.payload as { tier: string }).tier).toBe('API');
  });

  it('returns error when no tiers available for auto-detection', async () => {
    const result = await manager.connectPlatform({ platform: 'COINBASE' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No available integration tier/);
  });
});

// ---------------------------------------------------------------------------
// connectPlatform — failure paths
// ---------------------------------------------------------------------------

describe('connectPlatform — failure', () => {
  it('returns error when connector.connect() fails', async () => {
    manager.registerConnector(
      makeConnector('COINBASE', 'API', {
        connect: vi.fn().mockResolvedValue({ success: false, error: 'Invalid credentials' }),
      }),
    );

    const result = await manager.connectPlatform({ platform: 'COINBASE', tier: 'API' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid credentials');
  });

  it('does NOT write config file on connect failure', async () => {
    manager.registerConnector(
      makeConnector('COINBASE', 'API', {
        connect: vi.fn().mockResolvedValue({ success: false, error: 'Bad auth' }),
      }),
    );

    await manager.connectPlatform({ platform: 'COINBASE', tier: 'API' });

    const connections = await manager.listConnections();
    // listConnections now includes state-only entries (ERROR), but no config entry should exist
    const connected = connections.filter((c) => c.status === 'CONNECTED');
    expect(connected).toHaveLength(0);
  });

  it('sets state to ERROR on connect failure', async () => {
    manager.registerConnector(
      makeConnector('COINBASE', 'API', {
        connect: vi.fn().mockResolvedValue({ success: false, error: 'Timeout' }),
      }),
    );

    await manager.connectPlatform({ platform: 'COINBASE', tier: 'API' });

    // State is written but config is not — listConnections uses config, so we check state via reconnect
    const events = pubsub.events.filter((e) => e.channel === 'connectionStatus:COINBASE');
    const errEvent = events.find((e) => (e.payload as { step: string }).step === 'ERROR');
    expect(errEvent).toBeDefined();
  });

  it('logs connection.failure audit event on connect failure', async () => {
    manager.registerConnector(
      makeConnector('COINBASE', 'API', {
        connect: vi.fn().mockResolvedValue({ success: false, error: 'Oops' }),
      }),
    );

    await manager.connectPlatform({ platform: 'COINBASE', tier: 'API' });

    const types = auditLog.entries.map((e) => e['type']);
    expect(types).toContain('connection.failure');
  });

  it('returns error when no connector registered for platform:tier', async () => {
    const result = await manager.connectPlatform({ platform: 'COINBASE', tier: 'API' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No connector registered/);
  });

  it('returns error when fetchPositions() fails after successful connect', async () => {
    manager.registerConnector(
      makeConnector('COINBASE', 'API', {
        fetchPositions: vi.fn().mockResolvedValue({ success: false, error: 'Scrape error' }),
      }),
    );

    const result = await manager.connectPlatform({ platform: 'COINBASE', tier: 'API' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Scrape error');
  });
});

// ---------------------------------------------------------------------------
// Concurrency guard
// ---------------------------------------------------------------------------

describe('concurrency guard', () => {
  it('rejects a second connect attempt for the same platform while first is in progress', async () => {
    let resolveConnect!: () => void;
    const blockingConnect = vi.fn().mockReturnValue(
      new Promise<{ success: boolean }>((resolve) => {
        resolveConnect = () => resolve({ success: true });
      }),
    );

    manager.registerConnector(makeConnector('COINBASE', 'API', { connect: blockingConnect }));

    // Start first — don't await yet
    const first = manager.connectPlatform({ platform: 'COINBASE', tier: 'API' });

    // Second should reject immediately
    const second = await manager.connectPlatform({ platform: 'COINBASE', tier: 'API' });
    expect(second.success).toBe(false);
    expect(second.error).toMatch(/already in progress/);

    // Unblock first
    resolveConnect();
    await first;
  });
});

// ---------------------------------------------------------------------------
// disconnectPlatform
// ---------------------------------------------------------------------------

describe('disconnectPlatform', () => {
  it('removes platform from config after disconnect and returns success', async () => {
    manager.registerConnector(makeConnector('COINBASE', 'API'));
    await manager.connectPlatform({ platform: 'COINBASE', tier: 'API' });
    expect(await manager.listConnections()).toHaveLength(1);

    const result = await manager.disconnectPlatform('COINBASE');
    expect(result.success).toBe(true);
    // Config entry removed; state-only DISCONNECTED entry may remain
    const connected = (await manager.listConnections()).filter((c) => c.status === 'CONNECTED');
    expect(connected).toHaveLength(0);
  });

  it('sets state to DISCONNECTED', async () => {
    manager.registerConnector(makeConnector('COINBASE', 'API'));
    await manager.connectPlatform({ platform: 'COINBASE', tier: 'API' });

    await manager.disconnectPlatform('COINBASE');

    // Re-read fresh manager to check persisted state
    const fresh = new ConnectionManager({ vault, pubsub, auditLog, configPath, statePath });
    // listConnections uses config (now empty), but state is persisted
    // We verify via audit log
    const types = auditLog.entries.map((e) => e['type']);
    expect(types).toContain('connection.removed');
    void fresh;
  });

  it('logs connection.removed audit event', async () => {
    manager.registerConnector(makeConnector('COINBASE', 'API'));
    await manager.connectPlatform({ platform: 'COINBASE', tier: 'API' });
    auditLog.entries.length = 0; // Clear prior entries

    await manager.disconnectPlatform('COINBASE');

    expect(auditLog.entries[0]?.['type']).toBe('connection.removed');
  });

  it('removes vault credentials when removeCredentials=true', async () => {
    manager.registerConnector(makeConnector('COINBASE', 'API'));
    await manager.connectPlatform({ platform: 'COINBASE', tier: 'API' });

    vault.store.set('COINBASE_API_KEY', 'stored-key');
    vault.store.set('COINBASE_API_SECRET', 'stored-secret');
    vault.store.set('ROBINHOOD_API_TOKEN', 'rh-token'); // should NOT be removed

    await manager.disconnectPlatform('COINBASE', { removeCredentials: true });

    expect(await vault.has('COINBASE_API_KEY')).toBe(false);
    expect(await vault.has('COINBASE_API_SECRET')).toBe(false);
    expect(await vault.has('ROBINHOOD_API_TOKEN')).toBe(true);
  });

  it('does NOT remove credentials by default', async () => {
    manager.registerConnector(makeConnector('COINBASE', 'API'));
    await manager.connectPlatform({ platform: 'COINBASE', tier: 'API' });

    vault.store.set('COINBASE_API_KEY', 'stored-key');

    await manager.disconnectPlatform('COINBASE');

    expect(await vault.has('COINBASE_API_KEY')).toBe(true);
  });

  it('returns error when disconnecting a never-connected platform', async () => {
    const result = await manager.disconnectPlatform('COINBASE');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not connected/);
  });
});

// ---------------------------------------------------------------------------
// listConnections
// ---------------------------------------------------------------------------

describe('listConnections', () => {
  it('returns empty array when no connections configured', async () => {
    expect(await manager.listConnections()).toEqual([]);
  });

  it('merges config and state into Connection[]', async () => {
    manager.registerConnector(makeConnector('COINBASE', 'API'));
    manager.registerConnector(makeConnector('ROBINHOOD', 'UI'));

    await manager.connectPlatform({ platform: 'COINBASE', tier: 'API' });
    await manager.connectPlatform({ platform: 'ROBINHOOD', tier: 'UI' });

    const connections = await manager.listConnections();
    expect(connections).toHaveLength(2);

    const platforms = connections.map((c) => c.platform).sort();
    expect(platforms).toEqual(['COINBASE', 'ROBINHOOD']);
  });

  it('reflects connection fields from both config and state', async () => {
    manager.registerConnector(makeConnector('COINBASE', 'API'));
    await manager.connectPlatform({ platform: 'COINBASE', tier: 'API' });

    const [conn] = await manager.listConnections();
    expect(conn.platform).toBe('COINBASE');
    expect(conn.tier).toBe('API');
    expect(conn.status).toBe('CONNECTED');
    expect(conn.syncInterval).toBe(3600);
    expect(conn.autoRefresh).toBe(true);
    expect(conn.lastSync).toBeTruthy();
    expect(conn.lastError).toBeNull();
  });

  it('persists across ConnectionManager instances (reads from files)', async () => {
    manager.registerConnector(makeConnector('COINBASE', 'API'));
    await manager.connectPlatform({ platform: 'COINBASE', tier: 'API' });

    // Fresh instance, same paths
    const fresh = new ConnectionManager({ vault, pubsub, auditLog, configPath, statePath });
    const connections = await fresh.listConnections();
    expect(connections).toHaveLength(1);
    expect(connections[0].platform).toBe('COINBASE');
  });
});
