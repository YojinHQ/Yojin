/**
 * In-memory session store — suitable for development.
 */

import { randomUUID } from 'node:crypto';
import type { Session, SessionStore } from './types.js';

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, Session>();

  async get(id: string): Promise<Session | undefined> {
    return this.sessions.get(id);
  }

  async getByThread(channelId: string, threadId: string): Promise<Session | undefined> {
    for (const session of this.sessions.values()) {
      if (session.channelId === channelId && session.threadId === threadId) {
        return session;
      }
    }
    return undefined;
  }

  async create(data: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>): Promise<Session> {
    const now = Date.now();
    const session: Session = {
      ...data,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async update(id: string, updates: Partial<Session>): Promise<Session> {
    const existing = this.sessions.get(id);
    if (!existing) throw new Error(`Session not found: ${id}`);
    const updated = { ...existing, ...updates, updatedAt: Date.now() };
    this.sessions.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.sessions.delete(id);
  }
}
