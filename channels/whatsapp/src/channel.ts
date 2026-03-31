import { access, chmod, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { WAMessage, WASocket } from '@whiskeysockets/baileys';

import { chunkMessage, formatAction, formatInsight, formatSnap, toWhatsApp } from './formatting.js';
import { createWhatsAppSession } from './session.js';
import type { WhatsAppSession } from './session.js';
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
import type { PiiRedactor } from '../../../src/trust/pii/types.js';

const logger = createSubsystemLogger('whatsapp-channel');

const MAX_OUTBOUND_IDS = 200;

type MessageHandler = (msg: IncomingMessage) => Promise<void>;

export interface WhatsAppChannelDeps {
  notificationBus?: NotificationBus;
  piiRedactor?: PiiRedactor;
  approvalGate?: ApprovalGate;
  snapStore?: SnapStore;
  insightStore?: InsightStore;
  actionStore?: ActionStore;
  oauthDir?: string;
}

function getAuthDir(oauthDir?: string): string {
  const base = oauthDir ?? join(process.env.HOME ?? '', '.yojin', 'oauth');
  return join(base, 'whatsapp');
}

/** Read self JID from Baileys creds.json, stripping the device suffix from `me.id`. */
async function readSelfJid(authDir: string): Promise<string | undefined> {
  try {
    const raw = await readFile(join(authDir, 'creds.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { me?: { id?: string } };
    const rawJid = parsed?.me?.id;
    if (!rawJid) return undefined;
    return rawJid.replace(/:\d+@/, '@');
  } catch (err) {
    logger.debug('Failed to read self JID from creds.json', { error: err });
    return undefined;
  }
}

/** Scrub dollar amounts ($1,234.56), percentages with dollar context, and exact share counts from text. */
const DOLLAR_AMOUNT_RE = /\$[\d,]+(?:\.\d{1,2})?(?:\s*(?:k|m|M|B|billion|million|thousand))?/g;
const EXACT_SHARES_RE = /\b\d+(?:\.\d+)?\s*(?:shares?|units?|contracts?|lots?)\b/gi;

function redactSensitiveText(text: string, redactor?: PiiRedactor): string {
  let result = text.replace(DOLLAR_AMOUNT_RE, '<AMOUNT>').replace(EXACT_SHARES_RE, '<QTY>');

  if (redactor) {
    const { data } = redactor.redact({ text: result });
    result = data.text as string;
  }

  return result;
}

/**
 * Restricted socket proxy — only exposes self-chat operations.
 * The underlying WASocket has full access to the WhatsApp account.
 * This proxy makes it structurally impossible for any code path to
 * read other chats or send to other contacts.
 */
interface SelfChatSocket {
  sendMessage(text: string): Promise<string | undefined>;
  sendPresenceUpdate(type: 'composing' | 'paused' | 'available'): Promise<void>;
  onSelfChatMessage(handler: (msg: WAMessage) => void): () => void;
}

function createSelfChatProxy(sock: WASocket, selfJid: string, recentOutbound: Set<string>): SelfChatSocket {
  return {
    async sendMessage(text: string): Promise<string | undefined> {
      const sent = await sock.sendMessage(selfJid, { text });
      return sent?.key.id ?? undefined;
    },

    async sendPresenceUpdate(type: 'composing' | 'paused' | 'available'): Promise<void> {
      if (type === 'available') {
        await sock.sendPresenceUpdate('available');
      } else {
        await sock.sendPresenceUpdate(type, selfJid);
      }
    },

    onSelfChatMessage(handler: (msg: WAMessage) => void): () => void {
      const listener = ({ messages }: { messages: WAMessage[] }) => {
        for (const msg of messages) {
          const jid = msg.key.remoteJid;
          if (!jid || jid !== selfJid) continue;
          if (msg.key.id && recentOutbound.has(msg.key.id)) continue;
          handler(msg);
        }
      };
      sock.ev.on('messages.upsert', listener);
      return () => {
        sock.ev.off('messages.upsert', listener);
      };
    },
  };
}

export function buildWhatsAppChannel(deps: WhatsAppChannelDeps = {}): ChannelPlugin {
  let session: WhatsAppSession | undefined;
  let selfJid: string | undefined;
  let proxy: SelfChatSocket | undefined;
  let messageListenerCleanup: (() => void) | undefined;
  const messageHandlers: MessageHandler[] = [];
  const unsubscribers: Array<() => void> = [];
  const recentOutbound: Set<string> = new Set();

  function trackOutbound(msgId: string): void {
    recentOutbound.add(msgId);
    if (recentOutbound.size > MAX_OUTBOUND_IDS) {
      const first = recentOutbound.values().next().value;
      if (first !== undefined) recentOutbound.delete(first);
    }
  }

  async function sendToSelf(text: string): Promise<void> {
    if (!proxy) return;
    const chunks = chunkMessage(text);
    for (const chunk of chunks) {
      const msgId = await proxy.sendMessage(chunk);
      if (msgId) trackOutbound(msgId);
    }
  }

  async function sendNotification(text: string): Promise<void> {
    await sendToSelf(redactSensitiveText(text, deps.piiRedactor));
  }

  const messagingAdapter: ChannelMessagingAdapter = {
    async sendMessage(msg: OutgoingMessage): Promise<void> {
      if (!proxy) throw new Error('WhatsApp socket not available');
      if (!selfJid) throw new Error('WhatsApp self-chat JID not resolved — pair via QR first');
      await sendToSelf(toWhatsApp(msg.text));
    },

    onMessage(handler: MessageHandler): void {
      messageHandlers.push(handler);
    },
  };

  const authAdapter: ChannelAuthAdapter = {
    async validateToken(_token: string): Promise<boolean> {
      const authDir = getAuthDir(deps.oauthDir);
      try {
        await access(join(authDir, 'creds.json'));
        return true;
      } catch {
        return false;
      }
    },
  };

  const setupAdapter: ChannelSetupAdapter = {
    async setup(_config: Record<string, unknown>): Promise<void> {
      const authDir = getAuthDir(deps.oauthDir);

      const hasAuth = await authAdapter.validateToken('');
      if (!hasAuth) {
        logger.info('No WhatsApp auth state found — skipping setup. Pair via UI first.');
        return;
      }

      selfJid = await readSelfJid(authDir);
      if (!selfJid) {
        logger.warn('Could not resolve self JID from creds.json — WhatsApp channel disabled');
        return;
      }
      logger.info('WhatsApp self-chat mode', { selfJid });

      await chmod(authDir, 0o700).catch((e) => logger.debug('chmod authDir failed', { error: e }));
      await chmod(join(authDir, 'creds.json'), 0o600).catch((e) => logger.debug('chmod creds failed', { error: e }));

      session = createWhatsAppSession({
        authDir,
        onQr: () => {
          logger.warn('QR code received during reconnect — session may have expired');
        },
        onConnected: () => {
          logger.info('WhatsApp connected (self-chat only)');
          rewireProxy();
        },
        onDisconnected: (reason) => {
          logger.warn('WhatsApp disconnected', { reason });
        },
        onLoggedOut: () => {
          logger.warn('WhatsApp session logged out — re-pairing required');
          if (messageListenerCleanup) {
            messageListenerCleanup();
            messageListenerCleanup = undefined;
          }
          session = undefined;
          proxy = undefined;
        },
      });

      await session.connect();

      if (deps.notificationBus) {
        subscribeToNotifications(deps.notificationBus);
      }
    },

    async teardown(): Promise<void> {
      if (messageListenerCleanup) {
        messageListenerCleanup();
        messageListenerCleanup = undefined;
      }

      for (const unsub of unsubscribers) {
        unsub();
      }
      unsubscribers.length = 0;

      if (session) {
        await session.disconnect();
        session = undefined;
        proxy = undefined;
      }
    },
  };

  const typingAdapter: ChannelTypingAdapter = {
    async startTyping(_channelId: string): Promise<TypingHandle> {
      if (!proxy) return { stop: async () => {} };

      await proxy.sendPresenceUpdate('composing').catch((e) => logger.debug('Presence update failed', { error: e }));

      const p = proxy;
      const interval = setInterval(() => {
        p.sendPresenceUpdate('composing').catch((e) => logger.debug('Presence update failed', { error: e }));
      }, 4000);

      return {
        stop: async () => {
          clearInterval(interval);
          await p.sendPresenceUpdate('paused').catch((e) => logger.debug('Presence update failed', { error: e }));
        },
      };
    },
  };

  function rewireProxy(): void {
    if (!session || !selfJid) return;
    const sock = session.getSocket();
    if (!sock) return;

    if (messageListenerCleanup) {
      messageListenerCleanup();
      messageListenerCleanup = undefined;
    }

    proxy = createSelfChatProxy(sock, selfJid, recentOutbound);
    messageListenerCleanup = wireMessageHandler(proxy);
  }

  function wireMessageHandler(selfChat: SelfChatSocket): () => void {
    return selfChat.onSelfChatMessage(async (msg) => {
      try {
        const text = msg.message?.conversation ?? msg.message?.extendedTextMessage?.text;
        if (!text || !selfJid) return;

        const approvalMatch = text.match(/^(APPROVE|REJECT)\s+(\S+)/i);
        if (approvalMatch?.[1] && approvalMatch[2] && deps.approvalGate) {
          const approved = approvalMatch[1].toUpperCase() === 'APPROVE';
          deps.approvalGate.resolve(approvalMatch[2], approved);
          return;
        }

        const incoming: IncomingMessage = {
          channelId: 'whatsapp',
          threadId: selfJid,
          userId: selfJid.replace(/@s\.whatsapp\.net$/, ''),
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
      } catch (err) {
        logger.error('Error processing incoming WhatsApp message', { error: err });
      }
    });
  }

  function subscribeToNotifications(bus: NotificationBus): void {
    unsubscribers.push(
      bus.on('snap.ready', async (event) => {
        if (!session?.isConnected() || !selfJid || !deps.snapStore) return;
        if (!(await isNotificationEnabled('whatsapp', 'snap.ready'))) return;
        try {
          const snap = await deps.snapStore.getLatest();
          if (!snap || snap.id !== event.snapId) return;
          await sendNotification(formatSnap(snap));
        } catch (err) {
          logger.error('Failed to push snap', { error: err });
        }
      }),
    );

    unsubscribers.push(
      bus.on('action.created', async (event) => {
        if (!session?.isConnected() || !selfJid || !deps.actionStore) return;
        if (!(await isNotificationEnabled('whatsapp', 'action.created'))) return;
        try {
          const action = await deps.actionStore.getById(event.actionId);
          if (!action) return;
          await sendNotification(formatAction(action));
        } catch (err) {
          logger.error('Failed to push action', { error: err });
        }
      }),
    );

    unsubscribers.push(
      bus.on('approval.requested', async (event) => {
        if (!session?.isConnected() || !selfJid) return;
        if (!(await isNotificationEnabled('whatsapp', 'approval.requested'))) return;
        try {
          const text = [
            '\u{1F6A8} *Approval Required*',
            '',
            `${event.action}: ${event.description}`,
            '',
            `Reply *APPROVE ${event.requestId}* to approve`,
            `Reply *REJECT ${event.requestId}* to reject`,
          ].join('\n');
          await sendNotification(text);
        } catch (err) {
          logger.error('Failed to push approval request', { error: err });
        }
      }),
    );

    unsubscribers.push(
      bus.on('insight.ready', async (event) => {
        if (!session?.isConnected() || !selfJid || !deps.insightStore) return;
        if (!(await isNotificationEnabled('whatsapp', 'insight.ready'))) return;
        try {
          const report = await deps.insightStore.getById(event.insightId);
          if (!report) return;
          await sendNotification(formatInsight(report));
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
    maxMessageLength: 65536,
  };

  return {
    id: 'whatsapp',
    name: 'WhatsApp',
    description: 'WhatsApp messaging channel via Baileys (self-chat only)',
    aliases: ['wa'],
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
