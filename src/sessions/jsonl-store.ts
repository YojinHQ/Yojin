/**
 * JSONL-backed session store — file-per-session persistence.
 *
 * File format:
 *   Line 0: SessionMetadata JSON
 *   Line 1+: SessionEntry JSON (one per appended message)
 */

import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { SessionEntry, SessionMetadata, SessionStore } from './types.js';
import type { AgentMessage } from '../core/types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('jsonl-store');

export class JsonlSessionStore implements SessionStore {
  private sequenceCounters = new Map<string, number>();
  private sequenceInitPromises = new Map<string, Promise<void>>();
  private threadIndex = new Map<string, string>();

  constructor(private readonly dir: string) {}

  async create(data: Omit<SessionMetadata, 'id' | 'createdAt'>): Promise<SessionMetadata> {
    await mkdir(this.dir, { recursive: true });

    const meta: SessionMetadata = {
      ...data,
      id: randomUUID(),
      createdAt: Date.now(),
    };

    await appendFile(this.filePath(meta.id), JSON.stringify(meta) + '\n');
    this.sequenceCounters.set(meta.id, 0);

    if (meta.channelId && meta.threadId) {
      this.threadIndex.set(`${meta.channelId}:${meta.threadId}`, meta.id);
    }

    return meta;
  }

  async get(id: string): Promise<SessionMetadata | undefined> {
    let content: string;
    try {
      content = await readFile(this.filePath(id), 'utf-8');
    } catch {
      return undefined;
    }

    const firstLine = content.split('\n')[0];
    if (!firstLine) return undefined;

    try {
      return JSON.parse(firstLine) as SessionMetadata;
    } catch {
      logger.warn(`Malformed metadata in session ${id}`);
      return undefined;
    }
  }

  async getByThread(channelId: string, threadId: string): Promise<SessionMetadata | undefined> {
    const key = `${channelId}:${threadId}`;
    const cached = this.threadIndex.get(key);
    if (cached) {
      const meta = await this.get(cached);
      if (meta) return meta;
      this.threadIndex.delete(key);
    }

    const ids = await this.list();
    for (const id of ids) {
      const meta = await this.get(id);
      if (meta && meta.channelId === channelId && meta.threadId === threadId) {
        this.threadIndex.set(key, id);
        return meta;
      }
    }
    return undefined;
  }

  async append(sessionId: string, message: AgentMessage): Promise<SessionEntry> {
    const filePath = this.filePath(sessionId);

    if (!this.sequenceCounters.has(sessionId)) {
      if (!this.sequenceInitPromises.has(sessionId)) {
        const initPromise = (async () => {
          let content: string;
          try {
            content = await readFile(filePath, 'utf-8');
          } catch {
            throw new Error(`Session not found: ${sessionId}`);
          }
          const lineCount = content.split('\n').filter(Boolean).length;
          this.sequenceCounters.set(sessionId, lineCount - 1);
        })();
        this.sequenceInitPromises.set(sessionId, initPromise);
      }
      const pending = this.sequenceInitPromises.get(sessionId);
      if (pending) await pending;
      this.sequenceInitPromises.delete(sessionId);
    }

    const sequence = this.sequenceCounters.get(sessionId) ?? 0;
    this.sequenceCounters.set(sessionId, sequence + 1);

    const entry: SessionEntry = {
      sessionId,
      sequence,
      timestamp: new Date().toISOString(),
      message,
    };

    await appendFile(filePath, JSON.stringify(entry) + '\n');
    return entry;
  }

  async getHistory(sessionId: string): Promise<SessionEntry[]> {
    let content: string;
    try {
      content = await readFile(this.filePath(sessionId), 'utf-8');
    } catch {
      return [];
    }

    const lines = content.split('\n').filter(Boolean);
    const entries: SessionEntry[] = [];

    for (let i = 1; i < lines.length; i++) {
      try {
        entries.push(JSON.parse(lines[i]) as SessionEntry);
      } catch {
        logger.warn(`Skipping malformed JSONL line in session ${sessionId}`);
      }
    }

    return entries;
  }

  async list(): Promise<string[]> {
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch {
      return [];
    }
    return files.filter((f) => f.endsWith('.jsonl')).map((f) => f.replace('.jsonl', ''));
  }

  async delete(id: string): Promise<void> {
    await rm(this.filePath(id), { force: true });
    this.sequenceCounters.delete(id);

    for (const [key, sessionId] of this.threadIndex) {
      if (sessionId === id) {
        this.threadIndex.delete(key);
      }
    }
  }

  private filePath(id: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error(`Invalid session id: ${id}`);
    }
    return join(this.dir, `${id}.jsonl`);
  }
}
