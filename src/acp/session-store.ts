import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AcpSession } from './types.js';
import { AcpSessionSchema } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('acp-session-store');

export class AcpSessionStore {
  private sessions = new Map<string, AcpSession>();
  private readonly filePath: string;

  constructor(private readonly dataDir: string) {
    this.filePath = join(dataDir, 'sessions.json');
    this.load();
  }

  create(cwd: string): AcpSession {
    const sessionId = randomUUID();
    const session: AcpSession = {
      sessionId,
      threadId: `acp:${sessionId}`,
      cwd,
      createdAt: Date.now(),
    };
    this.sessions.set(sessionId, session);
    this.persist();
    return session;
  }

  get(sessionId: string): AcpSession | undefined {
    return this.sessions.get(sessionId);
  }

  list(): AcpSession[] {
    return [...this.sessions.values()];
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.persist();
  }

  private persist(): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
    const data = [...this.sessions.values()];
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    renameSync(tmpPath, this.filePath);
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf-8'));
      const sessions = Array.isArray(raw) ? raw : [];
      for (const entry of sessions) {
        const parsed = AcpSessionSchema.safeParse(entry);
        if (parsed.success) {
          this.sessions.set(parsed.data.sessionId, parsed.data);
        }
      }
    } catch (err) {
      logger.warn('Failed to load ACP session store, starting fresh', { error: String(err) });
    }
  }
}
