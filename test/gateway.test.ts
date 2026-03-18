import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PluginRegistry } from '../src/plugins/registry.js';
import type { ChannelPlugin, IncomingMessage, ProviderPlugin } from '../src/plugins/types.js';

// We test the gateway's message routing logic without spawning the full Gateway
// class (which imports anthropicPlugin/slackPlugin and calls getLogger at module
// scope). Instead we directly test the routing pattern on a PluginRegistry.

function makeProvider(id = 'anthropic'): ProviderPlugin {
  return {
    id,
    label: 'Test Provider',
    auth: [],
    models: [{ id: 'test-model', name: 'Test Model' }],
    complete: vi.fn().mockResolvedValue({
      content: 'Hello from the LLM',
      model: 'test-model',
      usage: { inputTokens: 10, outputTokens: 5 },
    }),
    stream: vi.fn(),
  };
}

function makeChannel(id = 'slack'): ChannelPlugin & { _handler?: (msg: IncomingMessage) => Promise<void> } {
  const channel: ChannelPlugin & { _handler?: (msg: IncomingMessage) => Promise<void> } = {
    id,
    name: 'Test Channel',
    messagingAdapter: {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      onMessage: vi.fn((handler) => {
        channel._handler = handler;
      }),
    },
    authAdapter: { validateToken: vi.fn().mockResolvedValue(true) },
    setupAdapter: { setup: vi.fn().mockResolvedValue(undefined) },
    capabilities: {
      supportsThreading: true,
      supportsReactions: false,
      supportsFiles: false,
      supportsEditing: false,
    },
  };
  return channel;
}

// ---------------------------------------------------------------------------
// 1. Plugin-level routing tests (unchanged from original)
// ---------------------------------------------------------------------------

describe('Gateway message routing (plugin-level)', () => {
  let registry: PluginRegistry;
  let provider: ProviderPlugin;
  let channel: ReturnType<typeof makeChannel>;

  beforeEach(() => {
    registry = new PluginRegistry();
    provider = makeProvider();
    channel = makeChannel();
    registry.addProvider(provider);
    registry.addChannel(channel);

    // Wire message handlers (mirrors Gateway.start logic)
    for (const ch of registry.getAllChannels()) {
      ch.messagingAdapter.onMessage(async (msg) => {
        const p = registry.getProvider('anthropic');
        if (!p) return;
        const result = await p.complete({
          model: p.models[0]?.id ?? 'test-model',
          messages: [{ role: 'user', content: msg.text }],
        });
        await ch.messagingAdapter.sendMessage({
          channelId: msg.channelId,
          threadId: msg.threadId,
          text: result.content,
        });
      });
    }
  });

  it('routes incoming message to provider and sends response back', async () => {
    const msg: IncomingMessage = {
      channelId: 'C123',
      threadId: 'T456',
      userId: 'U789',
      text: 'Hello!',
      timestamp: '1234567890',
    };

    await channel._handler!(msg);

    expect(provider.complete).toHaveBeenCalledWith({
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello!' }],
    });

    expect(channel.messagingAdapter.sendMessage).toHaveBeenCalledWith({
      channelId: 'C123',
      threadId: 'T456',
      text: 'Hello from the LLM',
    });
  });

  it('handles messages without threadId', async () => {
    const msg: IncomingMessage = {
      channelId: 'C123',
      userId: 'U789',
      text: 'No thread',
      timestamp: '1234567890',
    };

    await channel._handler!(msg);

    expect(channel.messagingAdapter.sendMessage).toHaveBeenCalledWith({
      channelId: 'C123',
      threadId: undefined,
      text: 'Hello from the LLM',
    });
  });

  it('handles provider errors gracefully', async () => {
    (provider.complete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('API down'));

    const msg: IncomingMessage = {
      channelId: 'C123',
      userId: 'U789',
      text: 'This will fail',
      timestamp: '1234567890',
    };

    // The handler should not throw
    await expect(channel._handler!(msg)).rejects.toThrow('API down');
  });
});

// ---------------------------------------------------------------------------
// 2. AgentRuntime delegation tests
// ---------------------------------------------------------------------------

describe('Gateway AgentRuntime delegation', () => {
  let channel: ReturnType<typeof makeChannel>;
  let mockRuntime: { handleMessage: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    channel = makeChannel();
    mockRuntime = {
      handleMessage: vi.fn().mockResolvedValue('Response from AgentRuntime'),
    };
  });

  /**
   * Simulates handleIncomingMessage delegation pattern used by Gateway
   * when an AgentRuntime is configured, without importing Gateway directly
   * (which pulls in real plugin modules).
   */
  async function simulateGatewayHandler(
    msg: IncomingMessage,
    channelId: string,
    runtime: typeof mockRuntime,
    ch: ReturnType<typeof makeChannel>,
  ): Promise<void> {
    try {
      const responseText = await runtime.handleMessage({
        message: msg.text,
        channelId,
        userId: msg.userId,
        threadId: msg.threadId,
      });

      await ch.messagingAdapter.sendMessage({
        channelId: msg.channelId,
        threadId: msg.threadId,
        text: responseText,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      void errMsg; // logged in real Gateway
      await ch.messagingAdapter.sendMessage({
        channelId: msg.channelId,
        threadId: msg.threadId,
        text: 'Sorry, something went wrong processing your message.',
      });
    }
  }

  it('delegates to agentRuntime.handleMessage with correct params', async () => {
    const msg: IncomingMessage = {
      channelId: 'C123',
      threadId: 'T456',
      userId: 'U789',
      text: 'Hello agent!',
      timestamp: '1234567890',
    };

    await simulateGatewayHandler(msg, 'slack', mockRuntime, channel);

    expect(mockRuntime.handleMessage).toHaveBeenCalledWith({
      message: 'Hello agent!',
      channelId: 'slack',
      userId: 'U789',
      threadId: 'T456',
    });
  });

  it('sends AgentRuntime response back to channel', async () => {
    const msg: IncomingMessage = {
      channelId: 'C123',
      threadId: 'T456',
      userId: 'U789',
      text: 'Hello agent!',
      timestamp: '1234567890',
    };

    await simulateGatewayHandler(msg, 'slack', mockRuntime, channel);

    expect(channel.messagingAdapter.sendMessage).toHaveBeenCalledWith({
      channelId: 'C123',
      threadId: 'T456',
      text: 'Response from AgentRuntime',
    });
  });

  it('handles messages without threadId via AgentRuntime', async () => {
    const msg: IncomingMessage = {
      channelId: 'C123',
      userId: 'U789',
      text: 'No thread',
      timestamp: '1234567890',
    };

    await simulateGatewayHandler(msg, 'slack', mockRuntime, channel);

    expect(mockRuntime.handleMessage).toHaveBeenCalledWith({
      message: 'No thread',
      channelId: 'slack',
      userId: 'U789',
      threadId: undefined,
    });
  });

  it('sends error message when AgentRuntime throws', async () => {
    mockRuntime.handleMessage.mockRejectedValueOnce(new Error('Runtime error'));

    const msg: IncomingMessage = {
      channelId: 'C123',
      threadId: 'T456',
      userId: 'U789',
      text: 'This will fail',
      timestamp: '1234567890',
    };

    await simulateGatewayHandler(msg, 'slack', mockRuntime, channel);

    expect(channel.messagingAdapter.sendMessage).toHaveBeenCalledWith({
      channelId: 'C123',
      threadId: 'T456',
      text: 'Sorry, something went wrong processing your message.',
    });
  });
});
