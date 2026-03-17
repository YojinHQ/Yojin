/**
 * FileAuditLog — append-only JSONL security audit log with HMAC chain.
 *
 * Writes to data/audit/security.jsonl. Each line is an independently
 * JSON-parseable AuditEvent. Uses synchronous writes to guarantee
 * no audit events are lost.
 *
 * HMAC chain: each event includes `prevHash` (HMAC of the previous event)
 * and `hash` (HMAC of the current event including prevHash). This creates
 * a tamper-evident chain — any modification to a past event breaks the chain.
 */

import { createHmac, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { AuditEvent, AuditEventInput, AuditFilter, AuditLog } from './types.js';
import { AuditEventSchema } from './types.js';

const HMAC_ALGO = 'sha256';
// Use env var for HMAC key if available; otherwise fall back to a fixed seed.
// With env-based key, an attacker with write access to the log file cannot
// re-compute valid HMACs without knowing the secret.
const HMAC_KEY = process.env.YOJIN_AUDIT_SECRET ?? 'yojin-audit-log-v1';

export class FileAuditLog implements AuditLog {
  private readonly filePath: string;
  private dirEnsured = false;
  private lastHash = '0000000000000000000000000000000000000000000000000000000000000000';

  constructor(auditDir?: string) {
    const dir = auditDir ?? 'data/audit';
    this.filePath = `${dir}/security.jsonl`;

    // Load the last hash from existing log
    this.loadLastHash();
  }

  append(input: AuditEventInput): void {
    const prevHash = this.lastHash;
    const event: AuditEvent = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      prevHash,
      ...input,
    };

    // Compute HMAC of this event (including prevHash for chaining)
    event.hash = this.computeHmac(event);

    // Validate before writing
    AuditEventSchema.parse(event);

    this.ensureDir();
    appendFileSync(this.filePath, JSON.stringify(event) + '\n', 'utf-8');
    this.lastHash = event.hash;
  }

  async query(filter?: AuditFilter): Promise<AuditEvent[]> {
    if (!existsSync(this.filePath)) {
      return [];
    }

    const content = readFileSync(this.filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    let events: AuditEvent[] = lines.map((line) => {
      const parsed = JSON.parse(line) as AuditEvent;
      return AuditEventSchema.parse(parsed);
    });

    if (!filter) return events;

    if (filter.type) {
      events = events.filter((e) => e.type === filter.type);
    }
    if (filter.agentId) {
      events = events.filter((e) => e.agentId === filter.agentId);
    }
    if (filter.since) {
      const since = filter.since;
      events = events.filter((e) => e.timestamp >= since);
    }
    if (filter.until) {
      const until = filter.until;
      events = events.filter((e) => e.timestamp <= until);
    }
    if (filter.limit !== undefined) {
      events = events.slice(-filter.limit);
    }

    return events;
  }

  /**
   * Verify the HMAC chain integrity of the entire log.
   * Returns { valid: true } or { valid: false, brokenAt: index, reason }.
   *
   * Works directly on raw JSONL lines to avoid Zod parse reordering fields.
   */
  async verifyChain(): Promise<{ valid: true } | { valid: false; brokenAt: number; reason: string }> {
    if (!existsSync(this.filePath)) return { valid: true };

    const content = readFileSync(this.filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return { valid: true };

    let expectedPrev = '0000000000000000000000000000000000000000000000000000000000000000';

    for (let i = 0; i < lines.length; i++) {
      const event = JSON.parse(lines[i]) as AuditEvent;

      // Check prevHash chain — always compare, even if prevHash is missing.
      // A missing prevHash on a non-first event means the field was stripped.
      const eventPrevHash = event.prevHash ?? '';
      if (eventPrevHash !== expectedPrev) {
        return {
          valid: false,
          brokenAt: i,
          reason: `prevHash mismatch at event ${i}: expected ${expectedPrev}, got ${eventPrevHash || '(missing)'}`,
        };
      }

      // Verify HMAC — recompute from the event without the hash field
      const storedHash = event.hash ?? '';
      if (!storedHash) {
        return {
          valid: false,
          brokenAt: i,
          reason: `Missing hash at event ${i}`,
        };
      }

      const { hash: _, ...rest } = event;
      const computed = createHmac(HMAC_ALGO, HMAC_KEY).update(JSON.stringify(rest)).digest('hex');
      if (computed !== storedHash) {
        return {
          valid: false,
          brokenAt: i,
          reason: `HMAC mismatch at event ${i}: computed ${computed}, stored ${storedHash}`,
        };
      }
      expectedPrev = storedHash;
    }

    return { valid: true };
  }

  /** Get the file path for testing/debugging. */
  getFilePath(): string {
    return this.filePath;
  }

  private computeHmac(event: AuditEvent): string {
    // Hash the event without the hash field itself
    const { hash: _, ...rest } = event;
    const payload = JSON.stringify(rest);
    return createHmac(HMAC_ALGO, HMAC_KEY).update(payload).digest('hex');
  }

  private loadLastHash(): void {
    try {
      if (!existsSync(this.filePath)) return;
      const content = readFileSync(this.filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      if (lines.length === 0) return;
      const last = JSON.parse(lines[lines.length - 1]) as AuditEvent;
      if (last.hash) {
        this.lastHash = last.hash;
      }
    } catch {
      // If we can't read the file, start fresh
    }
  }

  private ensureDir(): void {
    if (this.dirEnsured) return;
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    this.dirEnsured = true;
  }
}
