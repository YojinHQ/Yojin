/**
 * InsightStore — JSONL-backed persistence for ProcessInsights reports.
 *
 * Each report is appended as a single JSON line to `insights/reports.jsonl`
 * (relative to data root ~/.yojin/). Follows the same pattern as PortfolioSnapshotStore.
 *
 * File format:
 *   Each line: JSON object validated against InsightReportSchema.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { InsightReport } from './types.js';
import { InsightReportSchema } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('insight-store');

export class InsightStore {
  private readonly filePath: string;

  constructor(dataRoot: string) {
    this.filePath = join(dataRoot, 'insights', 'reports.jsonl');
  }

  /** Append a validated InsightReport. */
  async save(report: InsightReport): Promise<void> {
    const validated = InsightReportSchema.parse(report);
    await mkdir(join(this.filePath, '..'), { recursive: true });
    await appendFile(this.filePath, JSON.stringify(validated) + '\n');
    logger.info('Insight report saved', {
      id: validated.id,
      snapshotId: validated.snapshotId,
      positionCount: validated.positions.length,
    });
  }

  /** Read the latest report (last line). Returns null if no reports exist. */
  async getLatest(): Promise<InsightReport | null> {
    const lines = await this.readLines();
    if (lines.length === 0) return null;

    try {
      return InsightReportSchema.parse(JSON.parse(lines[lines.length - 1]));
    } catch {
      logger.warn('Failed to parse latest insight report line');
      return null;
    }
  }

  /** Read all reports. */
  async getAll(): Promise<InsightReport[]> {
    const lines = await this.readLines();
    const reports: InsightReport[] = [];

    for (const line of lines) {
      try {
        reports.push(InsightReportSchema.parse(JSON.parse(line)));
      } catch {
        logger.warn('Skipping malformed insight report line');
      }
    }

    return reports;
  }

  /** Find a report by ID. */
  async getById(id: string): Promise<InsightReport | null> {
    const all = await this.getAll();
    return all.find((r) => r.id === id) ?? null;
  }

  /** Find reports for a given snapshot. */
  async getBySnapshotId(snapshotId: string): Promise<InsightReport[]> {
    const all = await this.getAll();
    return all.filter((r) => r.snapshotId === snapshotId);
  }

  /** Read the most recent N reports. */
  async getRecent(limit: number): Promise<InsightReport[]> {
    const all = await this.getAll();
    return all.slice(-limit);
  }

  private async readLines(): Promise<string[]> {
    let content: string;
    try {
      content = await readFile(this.filePath, 'utf-8');
    } catch {
      return [];
    }
    return content.trim().split('\n').filter(Boolean);
  }
}
