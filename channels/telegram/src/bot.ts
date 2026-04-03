import { apiThrottler } from '@grammyjs/transformer-throttler';
import { Bot, InlineKeyboard } from 'grammy';

import { QUICK_ACTIONS } from '../../../src/channels/quick-actions.js';
import { createSubsystemLogger } from '../../../src/logging/logger.js';

const logger = createSubsystemLogger('telegram-bot');

const VALID_ACTIONS = new Set(['approve', 'reject', 'details', 'action-approve', 'action-reject', 'quick']);

export interface CallbackData {
  action: string;
  id: string;
}

export function parseCallbackData(data: string): CallbackData | null {
  const colonIdx = data.indexOf(':');
  if (colonIdx < 1) return null;

  const action = data.slice(0, colonIdx);
  const id = data.slice(colonIdx + 1);

  if (!VALID_ACTIONS.has(action) || id.length === 0) return null;

  return { action, id };
}

export function buildApprovalKeyboard(requestId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('\u{2705} Approve', `approve:${requestId}`)
    .text('\u{274C} Reject', `reject:${requestId}`)
    .row()
    .text('\u{1F4CB} Details', `details:${requestId}`);
}

export function buildActionKeyboard(actionId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('\u{2705} Approve', `action-approve:${actionId}`)
    .text('\u{274C} Reject', `action-reject:${actionId}`);
}

/** Builds a 2×2 inline keyboard with the predefined quick-action buttons for the Telegram /start message. */
export function buildQuickActionsKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  QUICK_ACTIONS.forEach((action, i) => {
    kb.text(action.label, `quick:${action.id}`);
    if (i % 2 === 1) kb.row();
  });
  return kb;
}

export interface BotDeps {
  token: string;
  onTextMessage: (chatId: number, userId: number, userName: string, text: string) => Promise<void>;
  onApprovalCallback?: (requestId: string, approved: boolean) => void;
  onActionCallback?: (actionId: string, approved: boolean) => Promise<void>;
  onApprovalDetails?: (requestId: string) => Promise<string>;
}

export function createBot(deps: BotDeps): Bot {
  const bot = new Bot(deps.token);
  bot.api.config.use(apiThrottler());

  bot.command('start', async (ctx) => {
    logger.info('Telegram /start', { chatId: ctx.chat.id, userId: ctx.from?.id });
    await ctx.reply("<b>Welcome to Yojin!</b> Your chat is now linked.\n\nLet's knock something off your list:", {
      parse_mode: 'HTML',
      reply_markup: buildQuickActionsKeyboard(),
    });
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      '/snap — Latest attention brief\n/portfolio — Portfolio summary\n/actions — Pending actions for review\n/help — Show this message',
    );
  });

  bot.on('callback_query:data', async (ctx) => {
    const data = parseCallbackData(ctx.callbackQuery.data);

    if (!data) {
      await ctx.answerCallbackQuery({ text: 'Unknown action' });
      return;
    }

    switch (data.action) {
      case 'approve':
        deps.onApprovalCallback?.(data.id, true);
        await ctx.editMessageText('\u{2705} Approved');
        await ctx.answerCallbackQuery({ text: 'Approved' });
        break;

      case 'reject':
        deps.onApprovalCallback?.(data.id, false);
        await ctx.editMessageText('\u{274C} Rejected');
        await ctx.answerCallbackQuery({ text: 'Rejected' });
        break;

      case 'details': {
        const details = await deps.onApprovalDetails?.(data.id);
        await ctx.answerCallbackQuery({ text: details ?? 'No details available', show_alert: true });
        break;
      }

      case 'action-approve':
        await deps.onActionCallback?.(data.id, true);
        await ctx.editMessageText('\u{2705} Action approved');
        await ctx.answerCallbackQuery({ text: 'Approved' });
        break;

      case 'action-reject':
        await deps.onActionCallback?.(data.id, false);
        await ctx.editMessageText('\u{274C} Action rejected');
        await ctx.answerCallbackQuery({ text: 'Rejected' });
        break;

      case 'quick': {
        const quickAction = QUICK_ACTIONS.find((a) => a.id === data.id);
        if (!quickAction) {
          await ctx.answerCallbackQuery({ text: 'Unknown action' });
          break;
        }
        await ctx.answerCallbackQuery();
        const chatId = ctx.chat?.id ?? ctx.from.id;
        await deps.onTextMessage(chatId, ctx.from.id, ctx.from.first_name ?? String(ctx.from.id), quickAction.prompt);
        break;
      }

      default:
        await ctx.answerCallbackQuery();
    }
  });

  bot.on('message:text', async (ctx) => {
    try {
      await deps.onTextMessage(ctx.chat.id, ctx.from.id, ctx.from.first_name ?? String(ctx.from.id), ctx.message.text);
    } catch (err) {
      logger.error('Error handling message', { chatId: ctx.chat.id, error: err });
      await ctx.reply('Sorry, something went wrong.');
    }
  });

  return bot;
}
