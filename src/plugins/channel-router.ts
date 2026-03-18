/**
 * ChannelRouter — routes messages and alerts to channel plugins.
 *
 * Tracks per-user preferred channel for priority routing.
 */

import type { ChannelPlugin, OutgoingMessage } from './types.js';

export interface BroadcastResult {
  sent: string[];
  errors: Array<{ channelId: string; error: Error }>;
}

export class ChannelRouter {
  private channels = new Map<string, ChannelPlugin>();
  private preferredChannel = new Map<string, string>();

  register(channelId: string, plugin: ChannelPlugin): void {
    this.channels.set(channelId, plugin);
  }

  unregister(channelId: string): void {
    this.channels.delete(channelId);

    for (const [userId, preferred] of this.preferredChannel) {
      if (preferred === channelId) {
        this.preferredChannel.delete(userId);
      }
    }
  }

  async send(channelId: string, text: string, threadId?: string): Promise<void> {
    const plugin = this.channels.get(channelId);
    if (!plugin) throw new Error(`Channel not found: ${channelId}`);

    const msg: OutgoingMessage = { channelId, text, threadId };
    await plugin.messagingAdapter.sendMessage(msg);
  }

  async broadcast(text: string): Promise<BroadcastResult> {
    const entries = Array.from(this.channels.entries());
    const settled = await Promise.allSettled(
      entries.map(async ([id, plugin]) => {
        const msg: OutgoingMessage = { channelId: id, text };
        await plugin.messagingAdapter.sendMessage(msg);
        return id;
      }),
    );

    const sent: string[] = [];
    const errors: BroadcastResult['errors'] = [];

    for (let i = 0; i < settled.length; i++) {
      const result = settled[i];
      if (result.status === 'fulfilled') {
        sent.push(result.value);
      } else {
        errors.push({ channelId: entries[i][0], error: result.reason as Error });
      }
    }

    return { sent, errors };
  }

  setPreferred(userId: string, channelId: string): void {
    this.preferredChannel.set(userId, channelId);
  }

  /** Returns the user's preferred channel, falling back to the first registered channel. */
  getPreferred(userId: string): string | undefined {
    const preferred = this.preferredChannel.get(userId);
    if (preferred && this.channels.has(preferred)) return preferred;

    const first = this.channels.keys().next();
    return first.done ? undefined : first.value;
  }

  async sendToUser(userId: string, text: string, threadId?: string): Promise<void> {
    const channelId = this.getPreferred(userId);
    if (!channelId) throw new Error(`No channel available for user: ${userId}`);
    await this.send(channelId, text, threadId);
  }
}
