/**
 * Workflow log — appends WorkflowProgressEvents to a per-run JSONL file.
 *
 * Each run of process-insights gets a timestamped log file:
 *   data/insights/logs/2026-03-24T14-30-00.jsonl
 *
 * The log captures every event (stage transitions, activity messages, errors)
 * so the team can review and improve the pipeline based on real data.
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { WorkflowProgressEvent } from '../agents/orchestrator.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('workflow-log');

export class WorkflowLog {
  private readonly dir: string;
  private currentFile: string | null = null;
  private dirCreated = false;

  constructor(dataRoot: string) {
    this.dir = join(dataRoot, 'insights', 'logs');
  }

  /** Handle a workflow progress event — start a new file on 'start', append otherwise. */
  async write(event: WorkflowProgressEvent): Promise<void> {
    try {
      if (event.stage === 'start') {
        await this.ensureDir();
        const ts = event.timestamp.replace(/:/g, '-').replace(/\.\d+Z$/, '');
        this.currentFile = join(this.dir, `${ts}.jsonl`);
      }

      if (!this.currentFile) {
        // No 'start' event seen yet — use a fallback filename
        await this.ensureDir();
        const ts = new Date()
          .toISOString()
          .replace(/:/g, '-')
          .replace(/\.\d+Z$/, '');
        this.currentFile = join(this.dir, `${ts}.jsonl`);
      }

      await appendFile(this.currentFile, JSON.stringify(event) + '\n');
    } catch (err) {
      logger.warn('Failed to write workflow log', { error: err });
    }
  }

  private async ensureDir(): Promise<void> {
    if (this.dirCreated) return;
    await mkdir(this.dir, { recursive: true });
    this.dirCreated = true;
  }
}
