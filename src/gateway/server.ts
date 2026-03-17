/**
 * Gateway server — loads plugins, wires providers and channels,
 * and routes messages between them.
 */

import { PluginRegistry } from "../plugins/registry.js";
import { getLogger } from "../logging/index.js";
import type { YojinConfig } from "../config/config.js";
import type { IncomingMessage } from "../plugins/types.js";

// Built-in plugin imports
import { anthropicPlugin } from "../../providers/anthropic/index.js";
import { slackPlugin } from "../../channels/slack/index.js";

export class Gateway {
  private registry: PluginRegistry;
  private config: YojinConfig;
  private log = getLogger().sub("gateway");

  constructor(config: YojinConfig) {
    this.config = config;
    this.registry = new PluginRegistry();
  }

  /** Load all built-in and discovered plugins. */
  async loadPlugins(): Promise<void> {
    this.log.info("Loading plugins…");
    this.registry.loadPlugin(anthropicPlugin);
    this.registry.loadPlugin(slackPlugin);
    this.log.info("Plugins loaded");

    // TODO: Discover and load additional plugins from providers/ and channels/ directories
  }

  /** Initialize all plugins and wire message routing. */
  async start(): Promise<void> {
    await this.loadPlugins();
    await this.registry.initializeAll(this.config as unknown as Record<string, unknown>);

    // Wire message handlers: channel → provider → channel
    for (const channel of this.registry.getAllChannels()) {
      channel.messagingAdapter.onMessage(async (msg) => {
        await this.handleIncomingMessage(msg, channel.id);
      });
    }

    const providers = this.registry.getAllProviders().length;
    const channels = this.registry.getAllChannels().length;
    this.log.info(`Gateway started — ${providers} provider(s), ${channels} channel(s)`);
    console.log(`Yojin gateway started — ${providers} provider(s), ${channels} channel(s)`);
  }

  /** Route an incoming message to the configured LLM provider and respond. */
  private async handleIncomingMessage(
    msg: IncomingMessage,
    channelId: string,
  ): Promise<void> {
    const providerId = this.config.defaultProvider ?? "anthropic";
    const provider = this.registry.getProvider(providerId);

    if (!provider) {
      this.log.error(`No provider found: ${providerId}`);
      return;
    }

    const channel = this.registry.getChannel(channelId);
    if (!channel) {
      this.log.error(`No channel found: ${channelId}`);
      return;
    }

    const model = this.config.defaultModel ?? provider.models[0]?.id ?? "claude-sonnet-4-20250514";

    this.log.info(`Message from ${msg.userId} on ${channelId}`, {
      threadId: msg.threadId,
      textLength: msg.text.length,
    });

    try {
      const result = await provider.complete({
        model,
        messages: [{ role: "user", content: msg.text }],
      });

      this.log.info("Completion received", {
        model: result.model,
        usage: result.usage,
        contentLength: result.content.length,
      });

      await channel.messagingAdapter.sendMessage({
        channelId: msg.channelId,
        threadId: msg.threadId,
        text: result.content,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.log.error(`Error processing message: ${errMsg}`);
      await channel.messagingAdapter.sendMessage({
        channelId: msg.channelId,
        threadId: msg.threadId,
        text: "Sorry, something went wrong processing your message.",
      });
    }
  }

  /** Gracefully shut down. */
  async stop(): Promise<void> {
    this.log.info("Gateway shutting down…");
    await this.registry.shutdownAll();
    this.log.info("Gateway stopped");
    console.log("Yojin gateway stopped");
  }

  getRegistry(): PluginRegistry {
    return this.registry;
  }
}
