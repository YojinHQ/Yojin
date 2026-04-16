import { App, type SlackEventMiddlewareArgs } from '@slack/bolt';

import type { ActionStore } from '../../../src/actions/action-store.js';
import type { Action } from '../../../src/actions/types.js';
import { isNotificationEnabled } from '../../../src/api/graphql/resolvers/channels.js';
import { normalizeMimeToMedia } from '../../../src/channels/image-media-type.js';
import { QUICK_ACTIONS } from '../../../src/channels/quick-actions.js';
import type { NotificationBus } from '../../../src/core/notification-bus.js';
import type { ImageMediaType } from '../../../src/core/types.js';
import { formatTriggerStrength } from '../../../src/formatting/index.js';
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
    lines.push('*Summaries:*');
    for (const item of snap.actionItems) {
      lines.push(`• ${item.text}`);
    }
  }
  return lines.join('\n');
}

/** Format an insight-driven alert for Slack. */
function formatAlert(event: { symbol: string; severity: number; thesis: string }): string {
  const label = event.severity >= 0.9 ? 'CRITICAL' : 'HIGH';
  const icon = event.severity >= 0.9 ? ':rotating_light:' : ':warning:';
  return [`${icon} *${label} Alert: ${event.symbol}*`, '', event.thesis].join('\n');
}

/** Format an Action for Slack: verdict badge + headline + reasoning. */
function formatAction(action: Action): string {
  const ticker = action.tickers[0];
  const header = ticker ? `:zap: *${action.verdict} ${ticker}*` : `:zap: *${action.verdict}*`;
  const strength = action.triggerStrength ? `[${formatTriggerStrength(action.triggerStrength)}]` : '';
  const lines = [header, strength ? `${strength} ${action.what}` : action.what];
  if (action.why && action.why !== action.what) {
    lines.push('', action.why);
  }
  return lines.join('\n');
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
  // Top summaries (max 3)
  const summaries = report.portfolio?.actionItems ?? [];
  if (summaries.length > 0) {
    lines.push('');
    for (const item of summaries.slice(0, 3)) {
      const text = typeof item === 'string' ? item : item.text;
      lines.push(`\u{2022} ${text}`);
    }
  }
  lines.push('', '_Open Yojin for full report_');
  return lines.join('\n');
}

type SlackBlock = { type: string; [key: string]: unknown };

/** Returns Slack Block Kit blocks for the App Home quick-action menu. */
function buildQuickActionsBlocks(): SlackBlock[] {
  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: ":sparkles: *Let's knock something off your list*" },
    },
    {
      type: 'actions',
      block_id: 'quick_actions',
      elements: QUICK_ACTIONS.map((action) => ({
        type: 'button',
        text: { type: 'plain_text', text: action.label, emoji: false },
        action_id: 'quick_action',
        value: action.prompt,
      })),
    },
  ];
}

export function buildSlackChannel(deps: SlackChannelDeps = {}): ChannelPlugin {
  let app: App;
  let defaultChannelId: string | undefined;
  let botToken: string | undefined;
  const messageHandlers: MessageHandler[] = [];
  const unsubscribers: Array<() => void> = [];

  async function downloadSlackImage(
    files: unknown,
  ): Promise<{ imageBase64: string; imageMediaType: ImageMediaType } | undefined> {
    if (!botToken || !Array.isArray(files)) return undefined;
    const imageFile = files.find(
      (f): f is { url_private?: string; url_private_download?: string; mimetype?: string } =>
        typeof f === 'object' &&
        f !== null &&
        typeof (f as { mimetype?: unknown }).mimetype === 'string' &&
        (f as { mimetype: string }).mimetype.startsWith('image/'),
    );
    if (!imageFile) return undefined;

    const url = imageFile.url_private_download ?? imageFile.url_private;
    if (!url) return undefined;

    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${botToken}` } });
      if (!res.ok) {
        logger.warn('Failed to download Slack image', { status: res.status });
        return undefined;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      return {
        imageBase64: buffer.toString('base64'),
        imageMediaType: normalizeMimeToMedia(imageFile.mimetype),
      };
    } catch (err) {
      logger.warn('Error downloading Slack image', { error: err });
      return undefined;
    }
  }

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
      botToken = options?.botToken ?? process.env.SLACK_BOT_TOKEN;
      const appToken = options?.appToken ?? process.env.SLACK_APP_TOKEN;
      const signingSecret = options?.signingSecret ?? process.env.SLACK_SIGNING_SECRET;

      app = new App({
        token: botToken,
        appToken,
        signingSecret,
        socketMode: !!appToken,
      });

      app.message(async ({ message }: SlackEventMiddlewareArgs<'message'>) => {
        if (message.subtype && message.subtype !== 'file_share') return;

        const channelId = message.channel;
        if (!defaultChannelId) defaultChannelId = channelId;

        const rawText = ('text' in message ? message.text : '') as string;
        const files = 'files' in message ? message.files : undefined;
        const image = await downloadSlackImage(files);

        const incoming: IncomingMessage = {
          channelId,
          threadId: ('thread_ts' in message ? message.thread_ts : message.ts) as string,
          userId: ('user' in message ? message.user : 'unknown') as string,
          text: rawText || (image ? '(attached image)' : ''),
          timestamp: message.ts,
          raw: message,
          imageBase64: image?.imageBase64,
          imageMediaType: image?.imageMediaType,
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

      app.event('app_home_opened', async ({ event, client }) => {
        await client.views.publish({
          user_id: event.user,
          view: {
            type: 'home',
            blocks: buildQuickActionsBlocks(),
          },
        });
      });

      app.action('quick_action', async ({ body, ack, client }) => {
        await ack();
        const action = (body as { actions?: Array<{ value?: string }> }).actions?.[0];
        const prompt = action?.value;
        if (!prompt) return;

        const userId = body.user?.id ?? 'unknown';
        const dmResult = await client.conversations.open({ users: userId });
        const channelId = dmResult.channel?.id;
        if (!channelId) return;

        const incoming: IncomingMessage = {
          channelId,
          userId,
          text: prompt,
          timestamp: new Date().toISOString(),
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
      bus.on('alert.promoted', async (event) => {
        if (!defaultChannelId) return;
        if (!(await isNotificationEnabled('slack', 'alert.promoted'))) return;
        try {
          await app.client.chat.postMessage({ channel: defaultChannelId, text: formatAlert(event) });
        } catch (err) {
          logger.error('Failed to push alert', { error: err });
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
