import { App, type SlackEventMiddlewareArgs } from '@slack/bolt';

import type { ActionStore } from '../../../src/actions/action-store.js';
import { isNotificationEnabled } from '../../../src/api/graphql/resolvers/channels.js';
import type { NotificationBus } from '../../../src/core/notification-bus.js';
import type { InsightStore } from '../../../src/insights/insight-store.js';
import type { InsightReport } from '../../../src/insights/types.js';
import { createSubsystemLogger } from '../../../src/logging/logger.js';
import type {
  ChannelAuthAdapter,
  ChannelCapabilities,
  ChannelMessagingAdapter,
  ChannelPlugin,
  ChannelSetupAdapter,
  IncomingMessage,
  OutgoingMessage,
} from '../../../src/plugins/types.js';
import type { SnapStore } from '../../../src/snap/snap-store.js';
import { formatDisplayCardForSlack } from '../../../src/tools/channel-display-formatters.js';
import type { ApprovalGate } from '../../../src/trust/approval/approval-gate.js';

const logger = createSubsystemLogger('slack-channel');

type MessageHandler = (msg: IncomingMessage) => Promise<void>;

export interface SlackChannelDeps {
  notificationBus?: NotificationBus;
  approvalGate?: ApprovalGate;
  snapStore?: SnapStore;
  insightStore?: InsightStore;
  actionStore?: ActionStore;
}

function formatSnap(snap: { intelSummary: string; actionItems: { text: string; signalIds: string[] }[] }): string {
  const lines = [':clipboard: *Snap Brief*'];
  if (snap.intelSummary) {
    lines.push('', snap.intelSummary, '');
  }
  if (snap.actionItems.length > 0) {
    lines.push('*Actions:*');
    for (const item of snap.actionItems) {
      lines.push(`• ${item.text}`);
    }
  }
  return lines.join('\n');
}

function formatAction(action: { what: string; why: string; source: string }): string {
  const ticker = action.source?.match(/micro-observation:\s*(\S+)/)?.[1];
  const header = ticker ? `:zap: *${ticker}*` : ':zap: *New Action*';
  return [header, action.what].join('\n');
}

function formatInsight(report: InsightReport): string {
  const lines = [':bar_chart: *Daily Insights Report*', ''];
  if (report.portfolio) {
    lines.push(`*Health:* ${report.portfolio.overallHealth}`);
  }
  // Compact position ratings
  if (report.positions.length > 0) {
    const ratings = report.positions.map((p) => `${p.symbol} ${p.rating}`).join(' \u{2022} ');
    lines.push(ratings);
  }
  // Top actions (max 3)
  const actions = report.portfolio?.actionItems ?? [];
  if (actions.length > 0) {
    lines.push('');
    for (const item of actions.slice(0, 3)) {
      const text = typeof item === 'string' ? item : item.text;
      lines.push(`\u{2022} ${text}`);
    }
  }
  lines.push('', '_Open Yojin for full report_');
  return lines.join('\n');
}

export function buildSlackChannel(deps: SlackChannelDeps = {}): ChannelPlugin {
  let app: App;
  let defaultChannelId: string | undefined;
  const messageHandlers: MessageHandler[] = [];
  const unsubscribers: Array<() => void> = [];

  const messagingAdapter: ChannelMessagingAdapter = {
    async sendMessage(msg: OutgoingMessage): Promise<void> {
      let text = msg.text;
      if (msg.displayCards?.length) {
        const formatted = msg.displayCards.map((c) => formatDisplayCardForSlack(c)).join('\n\n');
        text = text ? `${text}\n\n${formatted}` : formatted;
      }
      await app.client.chat.postMessage({
        channel: msg.channelId,
        thread_ts: msg.threadId,
        text,
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

      app.message(async ({ message }: SlackEventMiddlewareArgs<'message'>) => {
        if (message.subtype) return;

        const channelId = message.channel;
        if (!defaultChannelId) defaultChannelId = channelId;

        const incoming: IncomingMessage = {
          channelId,
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
        const channelId = event.channel;
        if (!defaultChannelId) defaultChannelId = channelId;

        const incoming: IncomingMessage = {
          channelId,
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

      if (deps.notificationBus) {
        subscribeToNotifications(deps.notificationBus);
      }

      await app.start();
      logger.info('Slack channel connected');
    },

    async teardown(): Promise<void> {
      for (const unsub of unsubscribers) unsub();
      unsubscribers.length = 0;
      if (app) await app.stop();
    },
  };

  function subscribeToNotifications(bus: NotificationBus): void {
    unsubscribers.push(
      bus.on('snap.ready', async (event) => {
        if (!defaultChannelId || !deps.snapStore) return;
        if (!(await isNotificationEnabled('slack', 'snap.ready'))) return;
        try {
          const snap = await deps.snapStore.getLatest();
          if (!snap || snap.id !== event.snapId) return;
          await app.client.chat.postMessage({ channel: defaultChannelId, text: formatSnap(snap) });
        } catch (err) {
          logger.error('Failed to push snap', { error: err });
        }
      }),
    );

    unsubscribers.push(
      bus.on('action.created', async (event) => {
        if (!defaultChannelId || !deps.actionStore) return;
        if (!(await isNotificationEnabled('slack', 'action.created'))) return;
        try {
          const action = await deps.actionStore.getById(event.actionId);
          if (!action) return;
          await app.client.chat.postMessage({ channel: defaultChannelId, text: formatAction(action) });
        } catch (err) {
          logger.error('Failed to push action', { error: err });
        }
      }),
    );

    unsubscribers.push(
      bus.on('approval.requested', async (event) => {
        if (!defaultChannelId) return;
        if (!(await isNotificationEnabled('slack', 'approval.requested'))) return;
        try {
          const text = `:rotating_light: *Approval Required*\n\n${event.action}: ${event.description}`;
          await app.client.chat.postMessage({ channel: defaultChannelId, text });
        } catch (err) {
          logger.error('Failed to push approval request', { error: err });
        }
      }),
    );

    unsubscribers.push(
      bus.on('insight.ready', async (event) => {
        if (!defaultChannelId || !deps.insightStore) return;
        if (!(await isNotificationEnabled('slack', 'insight.ready'))) return;
        try {
          const report = await deps.insightStore.getById(event.insightId);
          if (!report) return;
          await app.client.chat.postMessage({ channel: defaultChannelId, text: formatInsight(report) });
        } catch (err) {
          logger.error('Failed to push insight', { error: err });
        }
      }),
    );
  }

  const capabilities: ChannelCapabilities = {
    supportsThreading: true,
    supportsReactions: true,
    supportsTyping: false,
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

    async initialize(config): Promise<void> {
      const slackConfig = config.channels?.find((c) => c.id === 'slack');

      if (!slackConfig?.enabled) {
        logger.info('Slack channel is disabled, skipping setup');
        return;
      }

      await setupAdapter.setup({ options: slackConfig.options ?? {} });
    },

    async shutdown(): Promise<void> {
      await setupAdapter.teardown?.();
    },
  };
}
