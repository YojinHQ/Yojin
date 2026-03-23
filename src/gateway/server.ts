/**
 * Gateway server — loads plugins, wires providers and channels,
 * and delegates message handling to AgentRuntime.
 *
 * The Gateway is a thin shell: plugin lifecycle + channel wiring.
 * All agent logic (sessions, tools, guards) lives in AgentRuntime.
 */

import { slackPlugin } from '../../channels/slack/index.js';
import { webPlugin } from '../../channels/web/index.js';
import { anthropicPlugin } from '../../providers/anthropic/index.js';
import { setChatAgentRuntime, setSessionStore } from '../api/graphql/resolvers/chat.js';
import { setPortfolioConnectionManager, setSnapshotStore } from '../api/graphql/resolvers/portfolio.js';
import type { YojinConfig } from '../config/config.js';
import type { AgentRuntime } from '../core/agent-runtime.js';
import { getLogger } from '../logging/index.js';
import { PluginRegistry } from '../plugins/registry.js';
import type { IncomingMessage } from '../plugins/types.js';
import type { PortfolioSnapshotStore } from '../portfolio/snapshot-store.js';
import type { ConnectionManager } from '../scraper/connection-manager.js';
import type { SessionStore } from '../sessions/types.js';

export class Gateway {
  private readonly registry: PluginRegistry;
  private readonly config: YojinConfig;
  private readonly agentRuntime: AgentRuntime;
  private readonly log = getLogger().sub('gateway');

  constructor(
    config: YojinConfig,
    agentRuntime: AgentRuntime,
    options?: {
      snapshotStore?: PortfolioSnapshotStore;
      connectionManager?: ConnectionManager;
      sessionStore?: SessionStore;
    },
  ) {
    this.config = config;
    this.registry = new PluginRegistry();
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
    this.registry.loadPlugin(slackPlugin);
    this.registry.loadPlugin(webPlugin);
    this.log.info('Plugins loaded');
  }

  /** Initialize all plugins and wire message routing. */
  async start(): Promise<void> {
    await this.loadPlugins();
    await this.registry.initializeAll(this.config as unknown as Record<string, unknown>);

    // Wire message handlers: channel → AgentRuntime → channel
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
      const responseText = await this.agentRuntime.handleMessage({
        message: msg.text,
        channelId,
        userId: msg.userId,
        threadId: msg.threadId,
      });

      await channel.messagingAdapter.sendMessage({
        channelId: msg.channelId,
        threadId: msg.threadId,
        text: responseText,
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
