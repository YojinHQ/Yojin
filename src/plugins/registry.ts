/**
 * Plugin registry — stores all registered providers and channels.
 */

import type { ChannelPlugin, ProviderPlugin, YojinPlugin, YojinPluginApi } from './types.js';

export class PluginRegistry {
  private providers = new Map<string, ProviderPlugin>();
  private channels = new Map<string, ChannelPlugin>();

  /** Create the API object that plugins use to register themselves. */
  createPluginApi(): YojinPluginApi {
    return {
      registerProvider: (provider) => this.addProvider(provider),
      registerChannel: (channel) => this.addChannel(channel),
    };
  }

  // -- Providers ------------------------------------------------------------

  addProvider(provider: ProviderPlugin): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider "${provider.id}" is already registered`);
    }
    this.providers.set(provider.id, provider);
  }

  getProvider(id: string): ProviderPlugin | undefined {
    return this.providers.get(id);
  }

  getAllProviders(): ProviderPlugin[] {
    return Array.from(this.providers.values());
  }

  // -- Channels -------------------------------------------------------------

  addChannel(channel: ChannelPlugin): void {
    if (this.channels.has(channel.id)) {
      throw new Error(`Channel "${channel.id}" is already registered`);
    }
    this.channels.set(channel.id, channel);
  }

  getChannel(id: string): ChannelPlugin | undefined {
    return this.channels.get(id);
  }

  getAllChannels(): ChannelPlugin[] {
    return Array.from(this.channels.values());
  }

  // -- Lifecycle ------------------------------------------------------------

  async initializeAll(config: Record<string, unknown>): Promise<void> {
    for (const provider of this.providers.values()) {
      try {
        await provider.initialize?.(config);
      } catch (err) {
        console.error(`[plugins] Provider "${provider.id}" failed to initialize:`, err);
      }
    }
    // Initialize channels in parallel so a slow/hanging channel doesn't block others.
    // Each channel gets a timeout — a hanging channel must not prevent others from starting.
    const CHANNEL_INIT_TIMEOUT_MS = 15_000;
    await Promise.allSettled(
      Array.from(this.channels.values()).map(async (channel) => {
        try {
          await Promise.race([
            channel.initialize?.(config),
            new Promise<void>((_, reject) =>
              setTimeout(
                () => reject(new Error(`Channel "${channel.id}" initialization timed out`)),
                CHANNEL_INIT_TIMEOUT_MS,
              ),
            ),
          ]);
        } catch (err) {
          console.error(`[plugins] Channel "${channel.id}" failed to initialize:`, err);
        }
      }),
    );
  }

  async shutdownAll(): Promise<void> {
    for (const channel of this.channels.values()) {
      await channel.shutdown?.();
    }
    for (const provider of this.providers.values()) {
      await provider.shutdown?.();
    }
  }

  /** Load a plugin module and register it. */
  loadPlugin(plugin: YojinPlugin): void {
    const api = this.createPluginApi();
    plugin.register(api);
  }
}
