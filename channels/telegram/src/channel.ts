import type { Bot } from 'grammy';

import { buildActionKeyboard, buildApprovalKeyboard, createBot } from './bot.js';
import { chunkMessage, formatAction, formatInsight, formatSnap } from './formatting.js';
import type { ActionStore } from '../../../src/actions/action-store.js';
import { isNotificationEnabled } from '../../../src/api/graphql/resolvers/channels.js';
import type { NotificationBus } from '../../../src/core/notification-bus.js';
import type { InsightStore } from '../../../src/insights/insight-store.js';
import { createSubsystemLogger } from '../../../src/logging/logger.js';
import type {
  ChannelAuthAdapter,
  ChannelCapabilities,
  ChannelMessagingAdapter,
  ChannelPlugin,
  ChannelSetupAdapter,
  ChannelTypingAdapter,
  IncomingMessage,
  OutgoingMessage,
  TypingHandle,
} from '../../../src/plugins/types.js';
import type { SnapStore } from '../../../src/snap/snap-store.js';
import type { ApprovalGate } from '../../../src/trust/approval/approval-gate.js';
import type { SecretVault } from '../../../src/trust/vault/types.js';

const logger = createSubsystemLogger('telegram-channel');

type MessageHandler = (msg: IncomingMessage) => Promise<void>;

export interface TelegramChannelDeps {
  vault?: SecretVault;
  notificationBus?: NotificationBus;
  approvalGate?: ApprovalGate;
  snapStore?: SnapStore;
  insightStore?: InsightStore;
  actionStore?: ActionStore;
}

export function buildTelegramChannel(deps: TelegramChannelDeps = {}): ChannelPlugin {
  let bot: Bot | undefined;
  let activeChatId: number | undefined;
  const messageHandlers: MessageHandler[] = [];
  const unsubscribers: Array<() => void> = [];

  const messagingAdapter: ChannelMessagingAdapter = {
    async sendMessage(msg: OutgoingMessage): Promise<void> {
      if (!bot) throw new Error('Telegram bot not initialized');

      const chatId = msg.threadId ?? String(activeChatId ?? '');
      if (!chatId) throw new Error('No Telegram chat ID available');

      const chunks = chunkMessage(msg.text);
      for (const chunk of chunks) {
        await bot.api.sendMessage(Number(chatId), chunk);
      }
    },

    onMessage(handler: MessageHandler): void {
      messageHandlers.push(handler);
    },
  };

  const authAdapter: ChannelAuthAdapter = {
    async validateToken(token: string): Promise<boolean> {
      try {
        const testBot = new (await import('grammy')).Bot(token);
        await testBot.api.getMe();
        return true;
      } catch {
        return false;
      }
    },
  };

  const setupAdapter: ChannelSetupAdapter = {
    async setup(_config: Record<string, unknown>): Promise<void> {
      let token: string | undefined;
      if (deps.vault && (await deps.vault.has('TELEGRAM_BOT_TOKEN'))) {
        token = await deps.vault.get('TELEGRAM_BOT_TOKEN');
      }

      if (!token) {
        logger.info('No TELEGRAM_BOT_TOKEN in vault — skipping Telegram setup');
        return;
      }

      bot = createBot({
        token,
        onTextMessage: async (chatId, userId, userName, text) => {
          if (activeChatId !== undefined && activeChatId !== chatId) {
            logger.warn('Telegram chat ID changed — notifications will go to new chat', {
              previous: activeChatId,
              current: chatId,
            });
          }
          activeChatId = chatId;

          const incoming: IncomingMessage = {
            channelId: 'telegram',
            threadId: String(chatId),
            userId: String(userId),
            userName,
            text,
            timestamp: new Date().toISOString(),
          };

          for (const handler of messageHandlers) {
            try {
              await handler(incoming);
            } catch (err) {
              logger.error('Message handler error', { error: err });
            }
          }
        },
        onApprovalCallback: (requestId, approved) => {
          deps.approvalGate?.resolve(requestId, approved);
        },
        onActionCallback: async (actionId, approved) => {
          if (!deps.actionStore) return;
          if (approved) {
            await deps.actionStore.approve(actionId);
          } else {
            await deps.actionStore.reject(actionId);
          }
        },
        onApprovalDetails: async (requestId) => {
          const pending = deps.approvalGate?.getPending() ?? [];
          const request = pending.find((r) => r.id === requestId);
          return request ? `${request.action}: ${request.description}` : 'Request not found or expired.';
        },
      });

      if (deps.notificationBus) {
        subscribeToNotifications(deps.notificationBus);
      }

      bot.start({
        onStart: () => {
          logger.info('Telegram bot started (long polling)');
        },
      });
    },

    async teardown(): Promise<void> {
      for (const unsub of unsubscribers) {
        unsub();
      }
      unsubscribers.length = 0;

      if (bot) {
        await bot.stop();
        bot = undefined;
      }
    },
  };

  const typingAdapter: ChannelTypingAdapter = {
    async startTyping(channelId: string): Promise<TypingHandle> {
      const chatId = Number(channelId) || activeChatId;
      if (!bot || !chatId) return { stop: async () => {} };

      const interval = setInterval(() => {
        bot?.api.sendChatAction(chatId, 'typing').catch(() => {});
      }, 4000);

      await bot.api.sendChatAction(chatId, 'typing').catch(() => {});

      return {
        stop: async () => {
          clearInterval(interval);
        },
      };
    },
  };

  function subscribeToNotifications(bus: NotificationBus): void {
    unsubscribers.push(
      bus.on('snap.ready', async (event) => {
        if (!bot || !activeChatId || !deps.snapStore) return;
        if (!(await isNotificationEnabled('telegram', 'snap.ready'))) return;
        try {
          const snap = await deps.snapStore.getLatest();
          if (!snap || snap.id !== event.snapId) return;
          const text = formatSnap(snap);
          const chunks = chunkMessage(text);
          for (const chunk of chunks) {
            await bot.api.sendMessage(activeChatId, chunk);
          }
        } catch (err) {
          logger.error('Failed to push snap', { error: err });
        }
      }),
    );

    unsubscribers.push(
      bus.on('action.created', async (event) => {
        if (!bot || !activeChatId || !deps.actionStore) return;
        if (!(await isNotificationEnabled('telegram', 'action.created'))) return;
        try {
          const action = await deps.actionStore.getById(event.actionId);
          if (!action) return;
          const text = formatAction(action);
          const keyboard = buildActionKeyboard(action.id);
          await bot.api.sendMessage(activeChatId, text, { reply_markup: keyboard });
        } catch (err) {
          logger.error('Failed to push action', { error: err });
        }
      }),
    );

    unsubscribers.push(
      bus.on('approval.requested', async (event) => {
        if (!bot || !activeChatId) return;
        if (!(await isNotificationEnabled('telegram', 'approval.requested'))) return;
        try {
          const text = `\u{1F6A8} Approval Required\n\n${event.action}: ${event.description}`;
          const keyboard = buildApprovalKeyboard(event.requestId);
          await bot.api.sendMessage(activeChatId, text, { reply_markup: keyboard });
        } catch (err) {
          logger.error('Failed to push approval request', { error: err });
        }
      }),
    );

    unsubscribers.push(
      bus.on('insight.ready', async (event) => {
        if (!bot || !activeChatId || !deps.insightStore) return;
        if (!(await isNotificationEnabled('telegram', 'insight.ready'))) return;
        try {
          const report = await deps.insightStore.getById(event.insightId);
          if (!report) return;
          const text = formatInsight(report);
          const chunks = chunkMessage(text);
          for (const chunk of chunks) {
            await bot.api.sendMessage(activeChatId, chunk);
          }
        } catch (err) {
          logger.error('Failed to push insight', { error: err });
        }
      }),
    );
  }

  const capabilities: ChannelCapabilities = {
    supportsThreading: false,
    supportsReactions: false,
    supportsTyping: true,
    supportsFiles: false,
    supportsEditing: false,
    maxMessageLength: 4096,
  };

  return {
    id: 'telegram',
    name: 'Telegram',
    description: 'Telegram bot messaging with push notifications',
    aliases: ['tg'],
    messagingAdapter,
    authAdapter,
    setupAdapter,
    typingAdapter,
    capabilities,

    async initialize(): Promise<void> {
      await setupAdapter.setup({});
    },

    async shutdown(): Promise<void> {
      await setupAdapter.teardown?.();
    },
  };
}
