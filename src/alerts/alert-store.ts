/**
 * Alert store — append-only JSONL storage with date-partitioned files.
 *
 * Stores insight-driven Alerts (ACTIVE -> DISMISSED). Updates are appended as
 * new lines — the latest entry for each ID wins on read.
 *
 * Dedup: each insightId can produce at most one alert. Per-ticker cooldown
 * prevents alert spam for the same asset within a configurable window.
 *
 * Storage layout:
 *   data/alerts/
 *     2026-04-16.jsonl
 *     2026-04-17.jsonl
 */

import { appendFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { Alert, AlertStatus } from './types.js';
import { AlertSchema } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('alert-store');

export interface AlertStoreOptions {
  dir: string; // e.g. 'data/alerts'
}

interface AlertQueryFilter {
  status?: AlertStatus;
  since?: string; // ISO date string
  limit?: number;
}

export class AlertStore {
  private readonly dir: string;
  private dirCreated = false;

  constructor(options: AlertStoreOptions) {
    this.dir = options.dir;
  }

  /** Create a new alert. Returns success:false if validation fails. */
  async create(alert: Alert): Promise<{ success: true; data: Alert } | { success: false; error: string }> {
    const parsed = AlertSchema.safeParse(alert);
    if (!parsed.success) {
      return { success: false, error: `Invalid alert: ${parsed.error.message}` };
    }

    await this.appendAlert(parsed.data);
    logger.info('Alert created', {
      id: parsed.data.id,
      symbol: parsed.data.symbol,
      severityLabel: parsed.data.severityLabel,
    });
    return { success: true, data: parsed.data };
  }

  /** Dismiss an active alert. Appends updated version (append-only). */
  async dismiss(id: string): Promise<{ success: true; data: Alert } | { success: false; error: string }> {
    const existing = await this.getById(id);
    if (!existing) {
      return { success: false, error: `Alert not found: ${id}` };
    }
    if (existing.status === 'DISMISSED') {
      return { success: false, error: `Alert ${id} is already dismissed` };
    }

    const updated: Alert = {
      ...existing,
      status: 'DISMISSED',
      dismissedAt: new Date().toISOString(),
    };
    await this.appendAlert(updated);
    logger.info('Alert dismissed', { id });
    return { success: true, data: updated };
  }

  /** Find a single alert by ID (returns latest version). */
  async getById(id: string): Promise<Alert | null> {
    const files = (await this.listFiles()).reverse(); // newest first

    for (const file of files) {
      const alerts = await this.readJsonlFile(file);
      for (let i = alerts.length - 1; i >= 0; i--) {
        if (alerts[i].id === id) return alerts[i];
      }
    }

    return null;
  }

  /** Check if an alert already exists for a given insightId. */
  async hasAlertForInsight(insightId: string): Promise<boolean> {
    // Check recent files (today + yesterday) for perf — alerts are date-partitioned
    const files = (await this.listFiles()).slice(-2);

    for (const file of files) {
      const alerts = await this.readJsonlFile(file);
      if (alerts.some((a) => a.insightId === insightId)) return true;
    }

    return false;
  }

  /**
   * Get the most recent ACTIVE alert for a ticker within a time window.
   * Used for cooldown dedup — if a recent alert exists, skip unless severity escalates.
   */
  async getLatestActiveForTicker(symbol: string, windowMs: number): Promise<Alert | null> {
    const cutoff = new Date(Date.now() - windowMs).toISOString();
    const files = (await this.listFiles()).reverse();

    for (const file of files) {
      const alerts = await this.readJsonlFile(file);
      for (let i = alerts.length - 1; i >= 0; i--) {
        const a = alerts[i];
        if (a.symbol === symbol && a.status === 'ACTIVE' && a.createdAt >= cutoff) {
          return a;
        }
      }
    }

    return null;
  }

  /** Query alerts with optional filters. */
  async query(filter: AlertQueryFilter = {}): Promise<Alert[]> {
    const files = (await this.listFiles(filter.since)).reverse(); // newest first
    const results: Alert[] = [];
    const limit = filter.limit ?? 50;

    for (const file of files) {
      if (results.length >= limit) break;

      const alerts = await this.readJsonlFile(file);
      for (let i = alerts.length - 1; i >= 0; i--) {
        if (results.length >= limit) break;
        const alert = alerts[i];
        if (filter.status && alert.status !== filter.status) continue;
        results.push(alert);
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async appendAlert(alert: Alert): Promise<void> {
    await this.ensureDir();
    const dateKey = alert.createdAt.slice(0, 10); // YYYY-MM-DD
    const filePath = join(this.dir, `${dateKey}.jsonl`);
    await appendFile(filePath, JSON.stringify(alert) + '\n');
  }

  private async listFiles(since?: string): Promise<string[]> {
    let dates: string[];
    try {
      const entries = await readdir(this.dir);
      dates = entries
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => f.replace('.jsonl', ''))
        .sort();
    } catch {
      return [];
    }

    if (since) {
      const sinceDate = since.slice(0, 10);
      dates = dates.filter((d) => d >= sinceDate);
    }

    return dates.map((d) => join(this.dir, `${d}.jsonl`));
  }

  /**
   * Read a JSONL file and deduplicate by ID (last entry wins).
   * Handles the append-only update model: when an alert is dismissed,
   * its updated version is appended.
   */
  private async readJsonlFile(filePath: string): Promise<Alert[]> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      const byId = new Map<string, Alert>();

      for (let i = 0; i < lines.length; i++) {
        try {
          const parsed = AlertSchema.safeParse(JSON.parse(lines[i]));
          if (parsed.success) {
            byId.set(parsed.data.id, parsed.data); // last write wins
          } else {
            logger.warn(`Skipping invalid alert at ${filePath}:${i}: ${parsed.error.message}`);
          }
        } catch {
          logger.warn(`Skipping malformed alert at ${filePath}:${i}`);
        }
      }

      return [...byId.values()];
    } catch {
      return [];
    }
  }

  private async ensureDir(): Promise<void> {
    if (this.dirCreated) return;
    await mkdir(this.dir, { recursive: true });
    this.dirCreated = true;
  }
}
