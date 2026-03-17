/**
 * Event log — append-only JSONL with in-memory ring buffer.
 *
 * NOT the security audit log (that's src/trust/, separate file, never truncated).
 */

import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Logger } from 'tslog';
import { z } from 'zod';

const logger = new Logger({ name: 'event-log' });

export interface EventEntry {
  id: string;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

const EventEnvelopeSchema = z.object({
  type: z.string().min(1),
  data: z.record(z.unknown()).default({}),
});

export interface EventLogOptions {
  bufferSize?: number;
}

export interface EventQueryFilter {
  type?: string;
  since?: string;
  until?: string;
  predicate?: (event: EventEntry) => boolean;
}

export class EventLog {
  private buffer: EventEntry[] = [];
  private readonly bufferSize: number;
  private readonly dir: string;
  private readonly filePath: string;

  constructor(dir: string, options?: EventLogOptions) {
    this.dir = dir;
    this.filePath = join(dir, 'events.jsonl');
    this.bufferSize = options?.bufferSize ?? 1000;
  }

  async initialize(): Promise<void> {
    let content: string;
    try {
      content = await readFile(this.filePath, 'utf-8');
    } catch {
      return; // File doesn't exist yet
    }

    const lines = content.split('\n').filter(Boolean);
    const startIdx = Math.max(0, lines.length - this.bufferSize);
    for (let i = startIdx; i < lines.length; i++) {
      try {
        this.buffer.push(JSON.parse(lines[i]) as EventEntry);
      } catch {
        logger.warn(`Skipping malformed event at line ${i}`);
      }
    }
  }

  async append(input: { type: string; data?: Record<string, unknown> }): Promise<EventEntry> {
    const validated = EventEnvelopeSchema.parse(input);

    const entry: EventEntry = {
      id: randomUUID(),
      type: validated.type,
      timestamp: new Date().toISOString(),
      data: validated.data,
    };

    await mkdir(this.dir, { recursive: true });
    await appendFile(this.filePath, JSON.stringify(entry) + '\n');

    if (this.buffer.length >= this.bufferSize) {
      this.buffer.shift();
    }
    this.buffer.push(entry);

    return entry;
  }

  query(filter: EventQueryFilter): EventEntry[] {
    return this.buffer.filter((event) => {
      if (filter.type && event.type !== filter.type) return false;
      if (filter.since && event.timestamp < filter.since) return false;
      if (filter.until && event.timestamp > filter.until) return false;
      if (filter.predicate && !filter.predicate(event)) return false;
      return true;
    });
  }

  recent(n: number): EventEntry[] {
    return this.buffer.slice(-n);
  }
}
