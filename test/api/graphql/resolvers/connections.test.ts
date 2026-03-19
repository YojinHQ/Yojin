import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  connectPlatformResolver,
  detectAvailableTiersResolver,
  disconnectPlatformResolver,
  listConnectionsResolver,
  setConnectionManager,
} from '../../../../src/api/graphql/resolvers/connections.js';
import type { ConnectionManager } from '../../../../src/scraper/connection-manager.js';

function createMockManager(): ConnectionManager {
  return {
    connectPlatform: vi.fn().mockResolvedValue({
      success: true,
      connection: {
        platform: 'COINBASE',
        tier: 'API',
        status: 'PENDING',
        lastSync: null,
        lastError: null,
        syncInterval: 3600,
        autoRefresh: true,
      },
    }),
    disconnectPlatform: vi.fn().mockResolvedValue({ success: true }),
    listConnections: vi.fn().mockResolvedValue([]),
    detectAvailableTiers: vi.fn().mockResolvedValue([
      { tier: 'API', available: true, requiresCredentials: ['COINBASE_API_KEY'] },
      { tier: 'SCREENSHOT', available: true, requiresCredentials: [] },
    ]),
  } as unknown as ConnectionManager;
}

describe('connection resolvers', () => {
  let manager: ReturnType<typeof createMockManager>;

  beforeEach(() => {
    manager = createMockManager();
    setConnectionManager(manager);
  });

  it('connectPlatform converts credential array to record', async () => {
    await connectPlatformResolver(null, {
      input: { platform: 'COINBASE', tier: 'API', credentials: [{ key: 'API_KEY', value: 'k' }] },
    });
    expect(manager.connectPlatform).toHaveBeenCalledWith({
      platform: 'COINBASE',
      tier: 'API',
      credentials: { API_KEY: 'k' },
    });
  });

  it('connectPlatform passes undefined credentials when none provided', async () => {
    await connectPlatformResolver(null, {
      input: { platform: 'COINBASE' },
    });
    expect(manager.connectPlatform).toHaveBeenCalledWith({
      platform: 'COINBASE',
      tier: undefined,
      credentials: undefined,
    });
  });

  it('disconnectPlatform passes platform and removeCredentials', async () => {
    await disconnectPlatformResolver(null, { platform: 'COINBASE', removeCredentials: true });
    expect(manager.disconnectPlatform).toHaveBeenCalledWith('COINBASE', { removeCredentials: true });
  });

  it('disconnectPlatform defaults removeCredentials to false', async () => {
    await disconnectPlatformResolver(null, { platform: 'COINBASE' });
    expect(manager.disconnectPlatform).toHaveBeenCalledWith('COINBASE', { removeCredentials: false });
  });

  it('disconnectPlatform returns success: true', async () => {
    const result = await disconnectPlatformResolver(null, { platform: 'COINBASE' });
    expect(result).toEqual({ success: true });
  });

  it('listConnections returns empty when no connections', async () => {
    const result = await listConnectionsResolver();
    expect(result).toEqual([]);
    expect(manager.listConnections).toHaveBeenCalled();
  });

  it('detectAvailableTiers delegates to ConnectionManager', async () => {
    const result = await detectAvailableTiersResolver(null, { platform: 'COINBASE' });
    expect(result).toHaveLength(2);
    expect(manager.detectAvailableTiers).toHaveBeenCalledWith('COINBASE');
  });
});
