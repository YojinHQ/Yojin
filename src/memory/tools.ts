import { z } from 'zod';

import type { SignalMemoryStore } from './memory-store.js';
import { MemoryAgentRoleSchema } from './types.js';
import type { MemoryAgentRole, MemoryEntry } from './types.js';
import type { ToolDefinition, ToolResult } from '../core/types.js';
import type { PiiRedactor } from '../trust/pii/types.js';

interface MemoryToolsOptions {
  stores: Map<MemoryAgentRole, SignalMemoryStore>;
  piiRedactor: PiiRedactor;
}

/** Redact natural language fields via the object-based PII redactor API. */
function redactText(piiRedactor: PiiRedactor, text: string): string {
  const { data } = piiRedactor.redact({ text });
  return data.text as string;
}

export function createMemoryTools(options: MemoryToolsOptions): ToolDefinition[] {
  const { stores, piiRedactor } = options;

  const storeSignalMemory: ToolDefinition = {
    name: 'store_signal_memory',
    description: 'Save a memory of the current analysis situation and recommendation for future reference.',
    parameters: z.object({
      agentRole: MemoryAgentRoleSchema.describe('The agent role storing this memory'),
      tickers: z.array(z.string().min(1)).min(1).describe('Tickers analyzed'),
      situation: z.string().min(1).describe('Current market context description'),
      recommendation: z.string().min(1).describe('The analysis or recommendation'),
      confidence: z.number().min(0).max(1).describe('Confidence level (0-1)'),
    }),
    execute: async (params): Promise<ToolResult> => {
      const store = stores.get(params.agentRole as MemoryAgentRole);
      if (!store) {
        return { content: `No memory store for role: ${params.agentRole}`, isError: true };
      }

      try {
        const id = await store.store({
          tickers: params.tickers,
          situation: redactText(piiRedactor, params.situation),
          recommendation: redactText(piiRedactor, params.recommendation),
          confidence: params.confidence,
        });
        return { content: JSON.stringify({ id }) };
      } catch (err) {
        return { content: `Failed to store memory: ${err}`, isError: true };
      }
    },
  };

  const recallSignalMemories: ToolDefinition = {
    name: 'recall_signal_memories',
    description:
      'Search past analysis memories for similar situations. Returns relevant precedents with lessons learned.',
    parameters: z.object({
      agentRole: MemoryAgentRoleSchema.describe('The agent role whose memories to search'),
      situation: z.string().min(1).describe('Current situation to match against past memories'),
      tickers: z.array(z.string().min(1)).optional().describe('Optional: filter to specific tickers'),
      topN: z.number().int().min(1).max(10).optional().describe('Number of results (default 3)'),
    }),
    execute: async (params): Promise<ToolResult> => {
      const store = stores.get(params.agentRole as MemoryAgentRole);
      if (!store) {
        return { content: `No memory store for role: ${params.agentRole}`, isError: true };
      }

      try {
        const results = await store.recall(params.situation, {
          topN: params.topN,
          tickers: params.tickers,
        });

        if (results.length === 0) {
          return { content: 'No matching memories found.' };
        }

        const formatted = results.map((r, i) => formatMemory(r.entry, r.score, i + 1)).join('\n\n');
        return { content: formatted };
      } catch (err) {
        return { content: `Failed to recall memories: ${err}`, isError: true };
      }
    },
  };

  return [storeSignalMemory, recallSignalMemories];
}

function formatMemory(entry: MemoryEntry, score: number, rank: number): string {
  const lines = [
    `### Memory ${rank} (${entry.createdAt.slice(0, 10)}, ${entry.tickers.join('/')}, confidence: ${entry.confidence}, score: ${score.toFixed(2)})`,
    `**Situation:** ${entry.situation}`,
    `**Recommendation:** ${entry.recommendation}`,
  ];

  if (entry.grade) {
    lines.push(`**Grade:** ${entry.grade} (return: ${entry.actualReturn?.toFixed(1)}%)`);
  }
  if (entry.outcome) {
    lines.push(`**Outcome:** ${entry.outcome}`);
  }
  if (entry.lesson) {
    lines.push(`**Lesson:** ${entry.lesson}`);
  }

  return lines.join('\n');
}
