import { describe, expect, it, vi } from 'vitest';

import { PluginRegistry } from '../src/plugins/registry.js';
import type { ChannelPlugin, ProviderPlugin, YojinPlugin } from '../src/plugins/types.js';

function makeProvider(id = 'test-provider'): ProviderPlugin {
  return {
    id,
    label: `Test Provider ${id}`,
    auth: [],
    models: [{ id: 'model-1', name: 'Model 1' }],
    complete: vi.fn().mockResolvedValue({ content: 'ok', model: 'model-1' }),
    stream: vi.fn(),
  };
}

function makeChannel(id = 'test-channel'): ChannelPlugin {
  return {
    id,
    name: `Test Channel ${id}`,
    messagingAdapter: {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      onMessage: vi.fn(),
    },
    authAdapter: { validateToken: vi.fn().mockResolvedValue(true) },
    setupAdapter: { setup: vi.fn().mockResolvedValue(undefined) },
    capabilities: {
      supportsThreading: false,
      supportsReactions: false,
      supportsFiles: false,
      supportsEditing: false,
    },
  };
}

describe('PluginRegistry', () => {
  describe('providers', () => {
    it('registers and retrieves a provider', () => {
      const registry = new PluginRegistry();
      const provider = makeProvider();
      registry.addProvider(provider);
      expect(registry.getProvider('test-provider')).toBe(provider);
    });

    it('returns undefined for unknown provider', () => {
      const registry = new PluginRegistry();
      expect(registry.getProvider('nope')).toBeUndefined();
    });

    it('throws on duplicate provider id', () => {
      const registry = new PluginRegistry();
      registry.addProvider(makeProvider('dup'));
      expect(() => registry.addProvider(makeProvider('dup'))).toThrow('Provider "dup" is already registered');
    });

    it('getAllProviders returns all registered providers', () => {
      const registry = new PluginRegistry();
      registry.addProvider(makeProvider('a'));
      registry.addProvider(makeProvider('b'));
      expect(registry.getAllProviders()).toHaveLength(2);
    });
  });

  describe('channels', () => {
    it('registers and retrieves a channel', () => {
      const registry = new PluginRegistry();
      const channel = makeChannel();
      registry.addChannel(channel);
      expect(registry.getChannel('test-channel')).toBe(channel);
    });

    it('returns undefined for unknown channel', () => {
      const registry = new PluginRegistry();
      expect(registry.getChannel('nope')).toBeUndefined();
    });

    it('throws on duplicate channel id', () => {
      const registry = new PluginRegistry();
      registry.addChannel(makeChannel('dup'));
      expect(() => registry.addChannel(makeChannel('dup'))).toThrow('Channel "dup" is already registered');
    });

    it('getAllChannels returns all registered channels', () => {
      const registry = new PluginRegistry();
      registry.addChannel(makeChannel('x'));
      registry.addChannel(makeChannel('y'));
      registry.addChannel(makeChannel('z'));
      expect(registry.getAllChannels()).toHaveLength(3);
    });
  });

  describe('createPluginApi', () => {
    it('returns api that registers providers and channels', () => {
      const registry = new PluginRegistry();
      const api = registry.createPluginApi();
      api.registerProvider(makeProvider('via-api'));
      api.registerChannel(makeChannel('via-api'));
      expect(registry.getProvider('via-api')).toBeDefined();
      expect(registry.getChannel('via-api')).toBeDefined();
    });
  });

  describe('loadPlugin', () => {
    it('calls plugin.register with the api', () => {
      const registry = new PluginRegistry();
      const plugin: YojinPlugin = {
        id: 'my-plugin',
        name: 'My Plugin',
        register: vi.fn((api) => {
          api.registerProvider(makeProvider('loaded'));
        }),
      };
      registry.loadPlugin(plugin);
      expect(plugin.register).toHaveBeenCalledOnce();
      expect(registry.getProvider('loaded')).toBeDefined();
    });
  });

  describe('lifecycle', () => {
    it('initializeAll calls initialize on all providers and channels', async () => {
      const registry = new PluginRegistry();
      const provider = makeProvider();
      provider.initialize = vi.fn().mockResolvedValue(undefined);
      const channel = makeChannel();
      channel.initialize = vi.fn().mockResolvedValue(undefined);

      registry.addProvider(provider);
      registry.addChannel(channel);
      await registry.initializeAll({ some: 'config' });

      expect(provider.initialize).toHaveBeenCalledWith({ some: 'config' });
      expect(channel.initialize).toHaveBeenCalledWith({ some: 'config' });
    });

    it('initializeAll works when plugins have no initialize method', async () => {
      const registry = new PluginRegistry();
      registry.addProvider(makeProvider());
      registry.addChannel(makeChannel());
      await expect(registry.initializeAll({})).resolves.toBeUndefined();
    });

    it('shutdownAll calls shutdown on all channels then providers', async () => {
      const registry = new PluginRegistry();
      const order: string[] = [];

      const provider = makeProvider();
      provider.shutdown = vi.fn(async () => {
        order.push('provider');
      });
      const channel = makeChannel();
      channel.shutdown = vi.fn(async () => {
        order.push('channel');
      });

      registry.addProvider(provider);
      registry.addChannel(channel);
      await registry.shutdownAll();

      expect(provider.shutdown).toHaveBeenCalledOnce();
      expect(channel.shutdown).toHaveBeenCalledOnce();
      // Channels shut down before providers
      expect(order).toEqual(['channel', 'provider']);
    });
  });
});
