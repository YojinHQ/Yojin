import { describe, expect, it, vi } from 'vitest';

import { createPlatformTools } from '../../src/scraper/adapter.js';
import type { ConnectionManager } from '../../src/scraper/connection-manager.js';

function createMockManager(): ConnectionManager {
  return {
    detectAvailableTiers: vi.fn().mockResolvedValue([
      { tier: 'API', available: true, requiresCredentials: ['COINBASE_API_KEY', 'COINBASE_API_SECRET'] },
      { tier: 'SCREENSHOT', available: true, requiresCredentials: [] },
    ]),
    connectPlatform: vi
      .fn()
      .mockResolvedValue({ success: true, connection: { platform: 'COINBASE', tier: 'API', status: 'CONNECTED' } }),
    disconnectPlatform: vi.fn().mockResolvedValue({ success: true }),
    listConnections: vi.fn().mockResolvedValue([]),
  } as unknown as ConnectionManager;
}

describe('createPlatformTools', () => {
  it('returns 3 tools', () => {
    const tools = createPlatformTools(createMockManager());
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name)).toEqual(['connect_platform', 'disconnect_platform', 'list_connections']);
  });

  describe('connect_platform', () => {
    it('returns tier info when called with only platform', async () => {
      const manager = createMockManager();
      const tools = createPlatformTools(manager);
      const connectTool = tools.find((t) => t.name === 'connect_platform')!;

      const result = await connectTool.execute({ platform: 'COINBASE' });
      expect(result.content).toContain('API');
      expect(result.content).toContain('SCREENSHOT');
      expect(manager.detectAvailableTiers).toHaveBeenCalledWith('COINBASE');
    });

    it('runs full connection when platform and tier provided', async () => {
      const manager = createMockManager();
      const tools = createPlatformTools(manager);
      const connectTool = tools.find((t) => t.name === 'connect_platform')!;

      const result = await connectTool.execute({ platform: 'COINBASE', tier: 'API' });
      expect(result.content).toContain('Connected');
      expect(manager.connectPlatform).toHaveBeenCalledWith({ platform: 'COINBASE', tier: 'API' });
    });

    it('returns error on connection failure', async () => {
      const manager = createMockManager();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager.connectPlatform as any).mockResolvedValue({ success: false, error: 'Invalid API key' });
      const tools = createPlatformTools(manager);
      const connectTool = tools.find((t) => t.name === 'connect_platform')!;

      const result = await connectTool.execute({ platform: 'COINBASE', tier: 'API' });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Invalid API key');
    });

    it('handles no available tiers', async () => {
      const manager = createMockManager();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager.detectAvailableTiers as any).mockResolvedValue([
        { tier: 'API', available: false, requiresCredentials: [] },
      ]);
      const tools = createPlatformTools(manager);
      const connectTool = tools.find((t) => t.name === 'connect_platform')!;

      const result = await connectTool.execute({ platform: 'COINBASE' });
      expect(result.content).toContain('No integration tiers');
    });
  });

  describe('disconnect_platform', () => {
    it('calls disconnectPlatform', async () => {
      const manager = createMockManager();
      const tools = createPlatformTools(manager);
      const tool = tools.find((t) => t.name === 'disconnect_platform')!;

      await tool.execute({ platform: 'COINBASE', removeCredentials: false });
      expect(manager.disconnectPlatform).toHaveBeenCalledWith('COINBASE', { removeCredentials: false });
    });

    it('returns error message on disconnect failure', async () => {
      const manager = createMockManager();
      (manager.disconnectPlatform as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        error: 'Platform not found',
      });
      const tools = createPlatformTools(manager);
      const tool = tools.find((t) => t.name === 'disconnect_platform')!;

      const result = await tool.execute({ platform: 'COINBASE', removeCredentials: false });
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Platform not found');
    });
  });

  describe('list_connections', () => {
    it('returns no connections message when empty', async () => {
      const manager = createMockManager();
      const tools = createPlatformTools(manager);
      const tool = tools.find((t) => t.name === 'list_connections')!;

      const result = await tool.execute({});
      expect(result.content).toContain('No connections');
    });

    it('formats connection list', async () => {
      const manager = createMockManager();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager.listConnections as any).mockResolvedValue([
        { platform: 'COINBASE', tier: 'API', status: 'CONNECTED', lastSync: '2026-03-19T10:00:00Z' },
      ]);
      const tools = createPlatformTools(manager);
      const tool = tools.find((t) => t.name === 'list_connections')!;

      const result = await tool.execute({});
      expect(result.content).toContain('COINBASE');
      expect(result.content).toContain('API');
      expect(result.content).toContain('CONNECTED');
    });
  });
});
