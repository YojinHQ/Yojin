/**
 * Slack channel plugin implementation.
 */

import { App, type SlackEventMiddlewareArgs } from '@slack/bolt';

import type {
  ChannelAuthAdapter,
  ChannelCapabilities,
  ChannelMessagingAdapter,
  ChannelPlugin,
  ChannelSetupAdapter,
  IncomingMessage,
  OutgoingMessage,
} from '../../../src/plugins/types.js';

type MessageHandler = (msg: IncomingMessage) => Promise<void>;

export function buildSlackChannel(): ChannelPlugin {
  let app: App;
  const messageHandlers: MessageHandler[] = [];

  const messagingAdapter: ChannelMessagingAdapter = {
    async sendMessage(msg: OutgoingMessage): Promise<void> {
      await app.client.chat.postMessage({
        channel: msg.channelId,
        thread_ts: msg.threadId,
        text: msg.text,
      });
    },
    onMessage(handler: MessageHandler): void {
      messageHandlers.push(handler);
    },
  };

  const authAdapter: ChannelAuthAdapter = {
    async validateToken(token: string): Promise<boolean> {
      try {
        const result = await app.client.auth.test({ token });
        return result.ok === true;
      } catch {
        return false;
      }
    },
    getScopes() {
      return ['app_mentions:read', 'channels:history', 'chat:write', 'im:history', 'im:read', 'im:write'];
    },
  };

  const setupAdapter: ChannelSetupAdapter = {
    async setup(config: Record<string, unknown>): Promise<void> {
      const options = config.options as Record<string, string> | undefined;
      const botToken = options?.botToken ?? process.env.SLACK_BOT_TOKEN;
      const appToken = options?.appToken ?? process.env.SLACK_APP_TOKEN;
      const signingSecret = options?.signingSecret ?? process.env.SLACK_SIGNING_SECRET;

      app = new App({
        token: botToken,
        appToken,
        signingSecret,
        socketMode: !!appToken,
      });

      // Listen for messages and app_mention events
      app.message(async ({ message }: SlackEventMiddlewareArgs<'message'>) => {
        if (message.subtype) return; // Ignore edits, joins, etc.

        const incoming: IncomingMessage = {
          channelId: message.channel,
          threadId: ('thread_ts' in message ? message.thread_ts : message.ts) as string,
          userId: ('user' in message ? message.user : 'unknown') as string,
          text: ('text' in message ? message.text : '') as string,
          timestamp: message.ts,
          raw: message,
        };

        for (const handler of messageHandlers) {
          await handler(incoming);
        }
      });

      app.event('app_mention', async ({ event }) => {
        const incoming: IncomingMessage = {
          channelId: event.channel,
          threadId: event.thread_ts ?? event.ts,
          userId: event.user ?? 'unknown',
          text: event.text,
          timestamp: event.ts,
          raw: event,
        };

        for (const handler of messageHandlers) {
          await handler(incoming);
        }
      });

      await app.start();
      console.log('Slack channel connected');
    },

    async teardown(): Promise<void> {
      if (app) {
        await app.stop();
      }
    },
  };

  const capabilities: ChannelCapabilities = {
    supportsThreading: true,
    supportsReactions: true,
    supportsFiles: true,
    supportsEditing: true,
    maxMessageLength: 40_000,
  };

  return {
    id: 'slack',
    name: 'Slack',
    description: 'Slack workspace messaging',
    aliases: ['slackbot'],
    messagingAdapter,
    authAdapter,
    setupAdapter,
    capabilities,

    async initialize(config: Record<string, unknown>): Promise<void> {
      // Find the slack channel config
      const channels = (config as Record<string, unknown>).channels as Array<{
        id: string;
        enabled: boolean;
        options?: Record<string, string>;
      }>;
      const slackConfig = channels?.find((c) => c.id === 'slack');

      if (!slackConfig?.enabled) {
        console.log('Slack channel is disabled, skipping setup');
        return;
      }

      await setupAdapter.setup({ options: slackConfig.options ?? {} });
    },

    async shutdown(): Promise<void> {
      await setupAdapter.teardown?.();
    },
  };
}
