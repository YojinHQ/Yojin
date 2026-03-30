/**
 * Integration-level test — verifies the Telegram channel builds
 * and wires correctly without a real Telegram API connection.
 */
import { describe, expect, it, vi } from 'vitest';

import { buildTelegramChannel } from '../../channels/telegram/src/channel.js';
import { NotificationBus } from '../../src/core/notification-bus.js';

describe('Telegram channel integration', () => {
  it('builds a valid ChannelPlugin', () => {
    const channel = buildTelegramChannel();

    expect(channel.id).toBe('telegram');
    expect(channel.name).toBe('Telegram');
    expect(channel.messagingAdapter).toBeDefined();
    expect(channel.authAdapter).toBeDefined();
    expect(channel.setupAdapter).toBeDefined();
    expect(channel.typingAdapter).toBeDefined();
    expect(channel.capabilities.maxMessageLength).toBe(4096);
    expect(channel.capabilities.supportsTyping).toBe(true);
  });

  it('skips setup when no vault token', async () => {
    const channel = buildTelegramChannel();
    // No vault provided — setup should skip without error
    await channel.initialize?.({});
  });

  it('registers message handlers', () => {
    const channel = buildTelegramChannel();
    const handler = vi.fn();
    channel.messagingAdapter.onMessage(handler);
  });

  it('accepts NotificationBus dependency', () => {
    const bus = new NotificationBus();
    const channel = buildTelegramChannel({ notificationBus: bus });
    expect(channel.id).toBe('telegram');
  });
});
