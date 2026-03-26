/**
 * AssessmentStore — date-partitioned JSONL store for agent signal assessments.
 *
 * Mirrors the CuratedSignalStore pattern: one file per day in data/signals/assessments/.
 * A separate watermark.json tracks pipeline progress for incremental processing.
 */

import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { AssessmentReport, AssessmentWatermark } from './assessment-types.js';
import { AssessmentReportSchema, AssessmentWatermarkSchema } from './assessment-types.js';
import { createSubsystemLogger } from '../../logging/logger.js';

const logger = createSubsystemLogger('assessment-store');

export class AssessmentStore {
  private readonly baseDir: string;
  private readonly watermarkPath: string;

  constructor(dataRoot: string) {
    this.baseDir = join(dataRoot, 'signals', 'assessments');
    this.watermarkPath = join(this.baseDir, 'watermark.json');
  }

  /** Persist an assessment report to the date-partitioned JSONL store. */
  async save(report: AssessmentReport): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });

    const date = report.assessedAt.slice(0, 10); // YYYY-MM-DD
    const filePath = join(this.baseDir, `${date}.jsonl`);
    const validated = AssessmentReportSchema.parse(report);
    await appendFile(filePath, JSON.stringify(validated) + '\n');

    logger.info('Assessment report saved', {
      id: report.id,
      tickers: report.tickers.length,
      kept: report.signalsKept,
    });
  }

  /** Get the most recent assessment report, or null if none exist. */
  async getLatest(): Promise<AssessmentReport | null> {
    const dateFiles = await this.listDateFiles();
    if (dateFiles.length === 0) return null;

    // Read from newest date file
    for (let i = dateFiles.length - 1; i >= 0; i--) {
      const reports = await this.readDateFile(dateFiles[i]);
      if (reports.length > 0) {
        return reports[reports.length - 1]; // last entry = most recent
      }
    }
    return null;
  }

  /**
   * Query assessments for a set of tickers.
   * Batch query — reads each date file once.
   */
  async queryByTickers(tickers: string[], opts?: { since?: string; limit?: number }): Promise<AssessmentReport[]> {
    const tickerSet = new Set(tickers);
    const since = opts?.since;
    const limit = opts?.limit ?? 100;

    const dateFiles = await this.listDateFiles(since);
    const results: AssessmentReport[] = [];

    // Newest first
    for (let i = dateFiles.length - 1; i >= 0; i--) {
      const reports = await this.readDateFile(dateFiles[i]);

      for (let j = reports.length - 1; j >= 0; j--) {
        const report = reports[j];
        const matches = report.tickers.some((t) => tickerSet.has(t));
        if (matches) {
          results.push(report);
          if (results.length >= limit) return results;
        }
      }
    }

    return results;
  }

  /** Get the latest watermark, or null if pipeline has never run. */
  async getLatestWatermark(): Promise<AssessmentWatermark | null> {
    try {
      const raw = await readFile(this.watermarkPath, 'utf-8');
      return AssessmentWatermarkSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  /** Persist watermark after a pipeline run. */
  async saveWatermark(watermark: AssessmentWatermark): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    const validated = AssessmentWatermarkSchema.parse(watermark);
    await writeFile(this.watermarkPath, JSON.stringify(validated, null, 2));
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /** List date files, optionally filtering by since date. */
  private async listDateFiles(since?: string): Promise<string[]> {
    let files: string[];
    try {
      files = await readdir(this.baseDir);
    } catch {
      return [];
    }

    return files
      .filter((f) => f.endsWith('.jsonl'))
      .filter((f) => !since || f.replace('.jsonl', '') >= since)
      .sort(); // ascending by date
  }

  /** Read and parse all assessment reports from a single date file. */
  private async readDateFile(fileName: string): Promise<AssessmentReport[]> {
    const filePath = join(this.baseDir, fileName);
    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      return [];
    }

    const results: AssessmentReport[] = [];
    for (const line of content.trim().split('\n')) {
      if (!line) continue;
      try {
        results.push(AssessmentReportSchema.parse(JSON.parse(line)));
      } catch {
        logger.warn('Skipping malformed assessment report line', { file: fileName });
      }
    }
    return results;
  }
}
