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

import { Logger } from 'tslog';

import type { SessionEntry, SessionMetadata, SessionStore } from './types.js';
import type { AgentMessage } from '../core/types.js';

const logger = new Logger({ name: 'jsonl-store' });

export class JsonlSessionStore implements SessionStore {
  constructor(private readonly dir: string) {}

  async create(data: Omit<SessionMetadata, 'id' | 'createdAt'>): Promise<SessionMetadata> {
    await mkdir(this.dir, { recursive: true });

    const meta: SessionMetadata = {
      ...data,
      id: randomUUID(),
      createdAt: Date.now(),
    };

    await appendFile(this.filePath(meta.id), JSON.stringify(meta) + '\n');
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
    const ids = await this.list();
    for (const id of ids) {
      const meta = await this.get(id);
      if (meta && meta.channelId === channelId && meta.threadId === threadId) {
        return meta;
      }
    }
    return undefined;
  }

  async append(sessionId: string, message: AgentMessage): Promise<SessionEntry> {
    const filePath = this.filePath(sessionId);

    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const lineCount = content.split('\n').filter(Boolean).length;
    const entry: SessionEntry = {
      sessionId,
      sequence: lineCount - 1, // subtract metadata line
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
  }

  private filePath(id: string): string {
    return join(this.dir, `${id}.jsonl`);
  }
}
