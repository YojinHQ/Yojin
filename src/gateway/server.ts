/**
 * Gateway server — loads plugins, wires providers and channels,
 * and routes messages through the agent loop.
 */

import { PluginRegistry } from '../plugins/registry.js';
import { getLogger } from '../logging/index.js';
import type { YojinConfig } from '../config/config.js';
import type { IncomingMessage } from '../plugins/types.js';
import type { AgentLoopProvider, AgentMessage } from '../core/types.js';
import { runAgentLoop } from '../core/agent-loop.js';
import { starterTools } from '../core/starter-tools.js';

// Built-in plugin imports
import { anthropicPlugin } from '../../providers/anthropic/index.js';
import { slackPlugin } from '../../channels/slack/index.js';
import { webPlugin } from '../../channels/web/index.js';

export class Gateway {
  private registry: PluginRegistry;
  private config: YojinConfig;
  private log = getLogger().sub('gateway');
  /** Per-thread conversation history with LRU eviction. */
  private threadHistory = new Map<string, AgentMessage[]>();
  private static readonly MAX_THREADS = 200;

  constructor(config: YojinConfig) {
    this.config = config;
    this.registry = new PluginRegistry();
  }

  /** Load all built-in and discovered plugins. */
  async loadPlugins(): Promise<void> {
    this.log.info('Loading plugins…');
    this.registry.loadPlugin(anthropicPlugin);
    this.registry.loadPlugin(slackPlugin);
    this.registry.loadPlugin(webPlugin);
    this.log.info('Plugins loaded');
  }

  /** Initialize all plugins and wire message routing. */
  async start(): Promise<void> {
    await this.loadPlugins();
    await this.registry.initializeAll(this.config as unknown as Record<string, unknown>);

    // Wire message handlers: channel → agent loop → channel
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

  /** Route an incoming message through the agent loop. */
  private async handleIncomingMessage(msg: IncomingMessage, channelId: string): Promise<void> {
    const providerId = this.config.defaultProvider ?? 'anthropic';
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

    // Check that the provider supports tool use
    const loopProvider = provider as unknown as AgentLoopProvider;
    if (typeof loopProvider.completeWithTools !== 'function') {
      this.log.error(`Provider "${providerId}" does not support completeWithTools`);
      return;
    }

    const model = this.config.defaultModel ?? provider.models[0]?.id ?? 'claude-sonnet-4-20250514';
    const threadKey = `${channelId}:${msg.threadId ?? msg.userId}`;

    this.log.info(`Message from ${msg.userId} on ${channelId}`, {
      threadId: msg.threadId,
      textLength: msg.text.length,
    });

    try {
      const history = this.threadHistory.get(threadKey) ?? [];

      const result = await runAgentLoop(msg.text, history, {
        provider: loopProvider,
        model,
        tools: starterTools,
        onEvent: (event) => {
          if (event.type === 'action') {
            this.log.info('Tool calls', {
              tools: event.toolCalls.map((t) => t.name),
            });
          }
        },
      });

      this.log.info('Agent loop complete', {
        model,
        iterations: result.iterations,
        usage: result.usage,
        responseLength: result.text.length,
      });

      // Update thread history (LRU: delete + re-insert moves key to end)
      this.threadHistory.delete(threadKey);
      this.threadHistory.set(threadKey, result.messages);

      // Evict oldest threads when over capacity
      if (this.threadHistory.size > Gateway.MAX_THREADS) {
        const oldest = this.threadHistory.keys().next().value!;
        this.threadHistory.delete(oldest);
      }

      await channel.messagingAdapter.sendMessage({
        channelId: msg.channelId,
        threadId: msg.threadId,
        text: result.text,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.log.error(`Error processing message: ${errMsg}`);
      await channel.messagingAdapter.sendMessage({
        channelId: msg.channelId,
        threadId: msg.threadId,
        text: 'Sorry, something went wrong processing your message.',
      });
    }
  }

  /** Gracefully shut down. */
  async stop(): Promise<void> {
    this.log.info('Gateway shutting down…');
    await this.registry.shutdownAll();
    this.log.info('Gateway stopped');
    console.log('Yojin gateway stopped');
  }

  getRegistry(): PluginRegistry {
    return this.registry;
  }
}
