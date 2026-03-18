/**
 * Session management types — tracks conversation state per user/channel.
 */

import type { AgentMessage } from '../core/types.js';

export interface SessionMetadata {
  id: string;
  channelId: string;
  threadId?: string;
  userId: string;
  providerId: string;
  model: string;
  createdAt: number;
}

export interface SessionEntry {
  sessionId: string;
  sequence: number;
  timestamp: string; // ISO 8601
  message: AgentMessage;
}

export interface SessionStore {
  create(metadata: Omit<SessionMetadata, 'id' | 'createdAt'>): Promise<SessionMetadata>;
  get(id: string): Promise<SessionMetadata | undefined>;
  getByThread(channelId: string, threadId: string): Promise<SessionMetadata | undefined>;
  append(sessionId: string, message: AgentMessage): Promise<SessionEntry>;
  getHistory(sessionId: string): Promise<SessionEntry[]>;
  list(): Promise<string[]>;
  delete(id: string): Promise<void>;
}
