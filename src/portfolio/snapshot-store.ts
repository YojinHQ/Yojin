/**
 * PortfolioSnapshotStore — JSONL-backed persistence for portfolio snapshots.
 *
 * Each snapshot is appended as a single JSON line to `snapshots/portfolio.jsonl`
 * (relative to data root ~/.yojin/). The latest snapshot is the current portfolio state.
 * Historical snapshots are preserved for tracking changes over time.
 *
 * File format:
 *   Each line: JSON object with id, positions, totals, metadata, and timestamp.
 */

import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Platform, PortfolioSnapshot, Position } from '../api/graphql/types.js';
import { createSubsystemLogger } from '../logging/logger.js';
import type { PiiRedactor, RedactedSnapshot } from '../trust/pii/types.js';
import { RedactedSnapshotSchema } from '../trust/pii/types.js';

const logger = createSubsystemLogger('snapshot-store');

export interface SaveSnapshotParams {
  positions: Position[];
  platform: Platform;
  existingSnapshot?: PortfolioSnapshot | null;
}

export class PortfolioSnapshotStore {
  private readonly filePath: string;

  constructor(dataRoot: string) {
    this.filePath = join(dataRoot, 'snapshots', 'portfolio.jsonl');
  }

  /**
   * Save positions for a single platform. Replaces ALL existing positions for
   * that platform; positions from other platforms are preserved. Positions with
   * no platform stamp are also cleared — they originated from an earlier save
   * and would otherwise accumulate as stale entries (e.g. sold positions that
   * never get explicitly removed). All incoming positions are stamped with the
   * declared platform. Returns the merged snapshot with recomputed totals.
   */
  async save(params: SaveSnapshotParams): Promise<PortfolioSnapshot> {
    await mkdir(join(this.filePath, '..'), { recursive: true });

    const { positions, platform: rawPlatform } = params;
    const platform = rawPlatform.toUpperCase();

    const stamped = positions.map((p) => ({ ...p, platform }));

    const existing = params.existingSnapshot !== undefined ? params.existingSnapshot : await this.getLatest();
    // Keep only positions from OTHER known platforms. Drop same-platform entries
    // (they're being replaced) and drop platform-less entries (stale from old saves).
    const otherPlatformPositions = (existing?.positions ?? []).filter(
      (p) => p.platform != null && p.platform.toUpperCase() !== platform,
    );
    const merged = [...otherPlatformPositions, ...stamped];

    const totalValue = merged.reduce((sum, p) => sum + p.marketValue, 0);
    const totalCost = merged.reduce((sum, p) => sum + p.costBasis * p.quantity, 0);
    const totalPnl = totalValue - totalCost;

    const snapshot: PortfolioSnapshot = {
      id: `snap-${randomUUID().slice(0, 8)}`,
      positions: merged,
      totalValue,
      totalCost,
      totalPnl,
      totalPnlPercent: totalCost > 0 ? (totalPnl / totalCost) * 100 : 0,
      totalDayChange: 0,
      totalDayChangePercent: 0,
      timestamp: new Date().toISOString(),
      platform: null,
    };

    await appendFile(this.filePath, JSON.stringify(snapshot) + '\n');
    logger.info('Snapshot saved', {
      id: snapshot.id,
      platform,
      positionCount: positions.length,
      totalPositions: merged.length,
    });

    return snapshot;
  }

  /** Read the latest snapshot (last line of the JSONL file). Returns null if no snapshots exist. */
  async getLatest(): Promise<PortfolioSnapshot | null> {
    let content: string;
    try {
      content = await readFile(this.filePath, 'utf-8');
    } catch {
      return null;
    }

    const lines = content.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return null;

    try {
      return JSON.parse(lines[lines.length - 1]) as PortfolioSnapshot;
    } catch {
      logger.warn('Failed to parse latest snapshot line');
      return null;
    }
  }

  /**
   * Return the latest snapshot with PII redacted — balances converted to
   * ranges, account IDs hashed. Use this before sending data to external
   * services (Jintel enrichment, etc.).
   */
  async getLatestRedacted(redactor: PiiRedactor): Promise<RedactedSnapshot | null> {
    const snapshot = await this.getLatest();
    if (!snapshot) return null;
    // Strip fields that allow exact balance reconstruction (quantity × currentPrice = marketValue)
    const sanitized = {
      ...snapshot,
      positions: snapshot.positions.map(({ currentPrice: _price, quantity: _qty, ...p }) => p),
    };
    const { data } = redactor.redact(sanitized as Record<string, unknown>);
    return RedactedSnapshotSchema.parse(data);
  }

  /** Remove all snapshots (used during onboarding reset). */
  async clearAll(): Promise<void> {
    const { unlink } = await import('node:fs/promises');
    const { existsSync } = await import('node:fs');
    if (existsSync(this.filePath)) {
      await unlink(this.filePath);
      logger.info('All snapshots cleared');
    }
  }

  /**
   * Append a timestamped copy of a snapshot for history tracking.
   * Unlike `save()`, this does not merge platforms — it simply records
   * the current portfolio state as a new data point for the chart.
   */
  async appendHistoryPoint(snapshot: PortfolioSnapshot): Promise<void> {
    await mkdir(join(this.filePath, '..'), { recursive: true });
    const point: PortfolioSnapshot = {
      ...snapshot,
      id: `snap-${randomUUID().slice(0, 8)}`,
      timestamp: new Date().toISOString(),
    };
    await appendFile(this.filePath, JSON.stringify(point) + '\n');
    logger.debug('History point appended', { id: point.id, totalValue: point.totalValue });
  }

  /** Read all snapshots (for history). */
  async getAll(): Promise<PortfolioSnapshot[]> {
    let content: string;
    try {
      content = await readFile(this.filePath, 'utf-8');
    } catch {
      return [];
    }

    const lines = content.trim().split('\n').filter(Boolean);
    const snapshots: PortfolioSnapshot[] = [];

    for (const line of lines) {
      try {
        snapshots.push(JSON.parse(line) as PortfolioSnapshot);
      } catch {
        logger.warn('Skipping malformed snapshot line');
      }
    }

    return snapshots;
  }
}
