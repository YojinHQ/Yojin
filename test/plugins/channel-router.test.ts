import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelRouter } from '../../src/plugins/channel-router.js';
import type {
  ChannelAuthAdapter,
  ChannelCapabilities,
  ChannelMessagingAdapter,
  ChannelPlugin,
  ChannelSetupAdapter,
  OutgoingMessage,
} from '../../src/plugins/types.js';

function createMockChannel(id: string): ChannelPlugin {
  const sendMessage = vi.fn<(msg: OutgoingMessage) => Promise<void>>().mockResolvedValue(undefined);
  const onMessage = vi.fn();

  const messagingAdapter: ChannelMessagingAdapter = { sendMessage, onMessage };
  const authAdapter: ChannelAuthAdapter = {
    validateToken: vi.fn().mockResolvedValue(true),
  };
  const setupAdapter: ChannelSetupAdapter = {
    setup: vi.fn().mockResolvedValue(undefined),
  };
  const capabilities: ChannelCapabilities = {
    supportsThreading: true,
    supportsReactions: false,
    supportsFiles: false,
    supportsEditing: false,
  };

  return {
    id,
    name: id,
    messagingAdapter,
    authAdapter,
    setupAdapter,
    capabilities,
  };
}

describe('ChannelRouter', () => {
  let router: ChannelRouter;
  let slack: ChannelPlugin;
  let web: ChannelPlugin;

  beforeEach(() => {
    router = new ChannelRouter();
    slack = createMockChannel('slack');
    web = createMockChannel('web');
    router.register('slack', slack);
    router.register('web', web);
  });

  it('sends to a specific channel', async () => {
    await router.send('slack', 'Hello Slack');

    expect(slack.messagingAdapter.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'slack', text: 'Hello Slack' }),
    );
    expect(web.messagingAdapter.sendMessage).not.toHaveBeenCalled();
  });

  it('throws when sending to unknown channel', async () => {
    await expect(router.send('telegram', 'Hello')).rejects.toThrow('Channel not found: telegram');
  });

  it('broadcasts to all channels', async () => {
    await router.broadcast('Alert!');

    expect(slack.messagingAdapter.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: 'Alert!' }));
    expect(web.messagingAdapter.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: 'Alert!' }));
  });

  it('tracks preferred channel per user', () => {
    router.setPreferred('user1', 'slack');
    router.setPreferred('user2', 'web');

    expect(router.getPreferred('user1')).toBe('slack');
    expect(router.getPreferred('user2')).toBe('web');
  });

  it('falls back to first registered channel when no preference', () => {
    const preferred = router.getPreferred('unknown-user');
    expect(preferred).toBe('slack');
  });

  it('sends to user preferred channel', async () => {
    router.setPreferred('user1', 'web');
    await router.sendToUser('user1', 'Personal message');

    expect(web.messagingAdapter.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Personal message' }),
    );
    expect(slack.messagingAdapter.sendMessage).not.toHaveBeenCalled();
  });

  it('sendToUser falls back when no preference set', async () => {
    await router.sendToUser('new-user', 'Welcome');

    expect(slack.messagingAdapter.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: 'Welcome' }));
  });

  it('unregisters a channel', async () => {
    router.unregister('slack');
    await expect(router.send('slack', 'Hello')).rejects.toThrow('Channel not found');
  });

  it('broadcast collects errors without stopping', async () => {
    const failChannel = createMockChannel('fail');
    (failChannel.messagingAdapter.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('send failed'));
    router.register('fail', failChannel);

    const results = await router.broadcast('Alert!');
    expect(results.errors).toHaveLength(1);
    expect(results.errors[0].channelId).toBe('fail');

    expect(slack.messagingAdapter.sendMessage).toHaveBeenCalled();
    expect(web.messagingAdapter.sendMessage).toHaveBeenCalled();
  });
});
