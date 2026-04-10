/**
 * Gateway server — loads plugins, wires providers and channels,
 * and delegates message handling to AgentRuntime.
 *
 * The Gateway is a thin shell: plugin lifecycle + channel wiring.
 * All agent logic (sessions, tools, guards) lives in AgentRuntime.
 */

import { webPlugin } from '../../channels/web/index.js';
import { anthropicPlugin } from '../../providers/anthropic/index.js';
import { setChatAgentRuntime, setSessionStore } from '../api/graphql/resolvers/chat.js';
import { setPortfolioConnectionManager, setSnapshotStore } from '../api/graphql/resolvers/portfolio.js';
import type { YojinConfig } from '../config/config.js';
import type { AgentRuntime } from '../core/agent-runtime.js';
import { getLogger } from '../logging/index.js';
import { PluginRegistry } from '../plugins/registry.js';
import type { IncomingMessage, YojinPlugin } from '../plugins/types.js';
import type { PortfolioSnapshotStore } from '../portfolio/snapshot-store.js';
import type { ConnectionManager } from '../scraper/connection-manager.js';
import type { SessionStore } from '../sessions/types.js';

export class Gateway {
  private readonly registry: PluginRegistry;
  private readonly config: YojinConfig;
  private readonly agentRuntime: AgentRuntime;
  private readonly extraPlugins: YojinPlugin[];
  private readonly log = getLogger().sub('gateway');

  constructor(
    config: YojinConfig,
    agentRuntime: AgentRuntime,
    options?: {
      snapshotStore?: PortfolioSnapshotStore;
      connectionManager?: ConnectionManager;
      sessionStore?: SessionStore;
      extraPlugins?: YojinPlugin[];
    },
  ) {
    this.config = config;
    this.registry = new PluginRegistry();
    this.extraPlugins = options?.extraPlugins ?? [];
    this.agentRuntime = agentRuntime;

    // Inject AgentRuntime into GraphQL chat resolver
    setChatAgentRuntime(agentRuntime);

    // Inject snapshot store into portfolio resolver
    if (options?.snapshotStore) {
      setSnapshotStore(options.snapshotStore);
    }

    // Inject connection manager into portfolio resolver for sync
    if (options?.connectionManager) {
      setPortfolioConnectionManager(options.connectionManager);
    }

    // Inject session store into chat resolver for session queries
    if (options?.sessionStore) {
      setSessionStore(options.sessionStore);
    }
  }

  /** Load all built-in and discovered plugins. */
  async loadPlugins(): Promise<void> {
    this.log.info('Loading plugins…');
    this.registry.loadPlugin(anthropicPlugin);
    this.registry.loadPlugin(webPlugin);
    for (const plugin of this.extraPlugins) {
      this.registry.loadPlugin(plugin);
    }
    this.log.info('Plugins loaded');
  }

  /** Initialize all plugins and wire message routing. */
  async start(): Promise<void> {
    await this.loadPlugins();
    await this.registry.initializeAll(this.config);

    // Wire message handlers: channel → AgentRuntime → channel
    for (const channel of this.registry.getAllChannels()) {
      channel.messagingAdapter.onMessage(async (msg) => {
        await this.handleIncomingMessage(msg, channel.id);
      });
    }

    const providers = this.registry.getAllProviders().length;
    const channels = this.registry.getAllChannels().length;
    this.log.info(`Gateway started — ${providers} provider(s), ${channels} channel(s)`);
    // The user-facing "ready" message lives in channels/web/src/channel.ts
    // printSplash() — it runs after the HTTP server is actually listening
    // and includes the bound port, which only the web channel knows.
  }

  /** Route an incoming message through AgentRuntime. */
  private async handleIncomingMessage(msg: IncomingMessage, channelId: string): Promise<void> {
    const channel = this.registry.getChannel(channelId);
    if (!channel) {
      this.log.error(`No channel found: ${channelId}`);
      return;
    }

    this.log.info(`Message from ${msg.userId} on ${channelId}`, {
      threadId: msg.threadId,
      textLength: msg.text.length,
    });

    try {
      const hasStreamingHandler = !!msg.onAgentEvent;

      // Collect display cards emitted during the agent loop
      const displayCards: import('../tools/display-data.js').DisplayCardData[] = [];
      const wrappedOnEvent: import('../core/types.js').AgentLoopEventHandler = (event) => {
        if (event.type === 'display_card') {
          displayCards.push(event.card);
        }
        // Forward to the channel's streaming handler if present
        msg.onAgentEvent?.(event);
      };

      const responseText = await this.agentRuntime.handleMessage({
        message: msg.text,
        channelId,
        userId: msg.userId,
        threadId: msg.threadId,
        onEvent: wrappedOnEvent,
      });

      if (!hasStreamingHandler) {
        await channel.messagingAdapter.sendMessage({
          channelId: msg.channelId,
          threadId: msg.threadId,
          text: responseText,
          displayCards: displayCards.length > 0 ? displayCards : undefined,
        });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.log.error(`Error processing message: ${errMsg}`);
      if (msg.onAgentEvent) return;
      await channel.messagingAdapter.sendMessage({
        channelId: msg.channelId,
        threadId: msg.threadId,
        text: `Something went wrong: ${errMsg}`,
      });
    }
  }

  /** Gracefully shut down. */
  async stop(): Promise<void> {
    this.log.info('Gateway shutting down…');
    await this.registry.shutdownAll();
    this.log.info('Gateway stopped');
    console.log('\nYojin stopped.');
  }

  getRegistry(): PluginRegistry {
    return this.registry;
  }
}
