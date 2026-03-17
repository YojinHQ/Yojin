/**
 * Session management types — tracks conversation state per user/channel.
 */

import type { ConversationTurn } from "../agents/types.js";

export interface Session {
  id: string;
  channelId: string;
  threadId?: string;
  userId: string;
  providerId: string;
  model: string;
  history: ConversationTurn[];
  createdAt: number;
  updatedAt: number;
}

export interface SessionStore {
  get(id: string): Promise<Session | undefined>;
  getByThread(channelId: string, threadId: string): Promise<Session | undefined>;
  create(session: Omit<Session, "id" | "createdAt" | "updatedAt">): Promise<Session>;
  update(id: string, updates: Partial<Session>): Promise<Session>;
  delete(id: string): Promise<void>;
}
