/**
 * In-memory session store — suitable for development and testing.
 */

import { randomUUID } from 'node:crypto';

import type { SessionEntry, SessionMetadata, SessionStore } from './types.js';
import type { AgentMessage } from '../core/types.js';

export class InMemorySessionStore implements SessionStore {
  private metadata = new Map<string, SessionMetadata>();
  private entries = new Map<string, SessionEntry[]>();

  async create(data: Omit<SessionMetadata, 'id' | 'createdAt'>): Promise<SessionMetadata> {
    const meta: SessionMetadata = {
      ...data,
      id: randomUUID(),
      createdAt: Date.now(),
    };
    this.metadata.set(meta.id, meta);
    this.entries.set(meta.id, []);
    return meta;
  }

  async get(id: string): Promise<SessionMetadata | undefined> {
    return this.metadata.get(id);
  }

  async getByThread(channelId: string, threadId: string): Promise<SessionMetadata | undefined> {
    for (const meta of this.metadata.values()) {
      if (meta.channelId === channelId && meta.threadId === threadId) {
        return meta;
      }
    }
    return undefined;
  }

  async append(sessionId: string, message: AgentMessage): Promise<SessionEntry> {
    const meta = this.metadata.get(sessionId);
    if (!meta) throw new Error(`Session not found: ${sessionId}`);

    const history = this.entries.get(sessionId) ?? [];
    const entry: SessionEntry = {
      sessionId,
      sequence: history.length,
      timestamp: new Date().toISOString(),
      message,
    };
    history.push(entry);
    this.entries.set(sessionId, history);
    return entry;
  }

  async getHistory(sessionId: string): Promise<SessionEntry[]> {
    return this.entries.get(sessionId) ?? [];
  }

  async list(): Promise<string[]> {
    return Array.from(this.metadata.keys());
  }

  async delete(id: string): Promise<void> {
    this.metadata.delete(id);
    this.entries.delete(id);
  }
}
