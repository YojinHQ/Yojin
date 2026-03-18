/**
 * Portfolio reasoning tool — structured chain-of-thought for investment decisions.
 *
 * Strategist-only. Takes a question and data points, builds a structured
 * reasoning chain, and persists it to working memory (frontal lobe).
 * Unlike generic LLM reasoning, this creates a durable record of the
 * decision process in the brain's commit history.
 */

import { z } from 'zod';

import type { EmotionTracker, FrontalLobe } from '../brain/types.js';
import type { ToolDefinition, ToolResult } from '../core/types.js';

export interface PortfolioReasoningOptions {
  frontalLobe: FrontalLobe;
  emotionTracker: EmotionTracker;
}

export function createPortfolioReasoningTools(options: PortfolioReasoningOptions): ToolDefinition[] {
  const { frontalLobe, emotionTracker } = options;

  const portfolioReasoning: ToolDefinition = {
    name: 'portfolio_reasoning',
    description:
      'Structured chain-of-thought analysis for investment decisions. ' +
      'Builds a reasoning chain from data points, records it in working memory, ' +
      'and returns the structured analysis. Use this for significant portfolio decisions.',
    parameters: z.object({
      question: z.string().min(1).describe('The investment question to analyze'),
      dataPoints: z
        .array(z.string())
        .min(1)
        .describe('Key data points informing the analysis (e.g. "AAPL RSI: 78", "VIX: 22")'),
      currentHypotheses: z.array(z.string()).optional().describe('Existing hypotheses to consider or challenge'),
    }),
    async execute(params: {
      question: string;
      dataPoints: string[];
      currentHypotheses?: string[];
    }): Promise<ToolResult> {
      const emotion = await emotionTracker.getEmotion();
      const existingMemory = await frontalLobe.get();

      // Build reasoning chain
      const timestamp = new Date().toISOString();
      const lines: string[] = [
        `## Reasoning Chain — ${timestamp}`,
        '',
        `### Question`,
        params.question,
        '',
        `### Data Points`,
        ...params.dataPoints.map((dp) => `- ${dp}`),
        '',
      ];

      if (params.currentHypotheses && params.currentHypotheses.length > 0) {
        lines.push('### Hypotheses Under Review');
        lines.push(...params.currentHypotheses.map((h) => `- ${h}`));
        lines.push('');
      }

      lines.push('### Emotional Context');
      lines.push(
        `- Confidence: ${emotion.confidence} (${emotion.confidence <= 0.4 ? 'hedged language warranted' : emotion.confidence >= 0.7 ? 'can be more direct' : 'balanced tone'})`,
      );
      lines.push(
        `- Risk Appetite: ${emotion.riskAppetite} (${emotion.riskAppetite <= 0.3 ? 'conservative recommendations' : emotion.riskAppetite >= 0.7 ? 'open to opportunities' : 'balanced risk approach'})`,
      );
      lines.push(`- Basis: ${emotion.reason}`);
      lines.push('');

      // Append to existing memory rather than replacing
      const updatedMemory = existingMemory.trim().endsWith('No active reasoning chains yet.')
        ? lines.join('\n')
        : `${existingMemory}\n\n---\n\n${lines.join('\n')}`;

      const commit = await frontalLobe.update(updatedMemory);

      return {
        content: [
          lines.join('\n'),
          '---',
          `Reasoning persisted to working memory. Commit: ${commit.hash.slice(0, 8)}`,
        ].join('\n'),
      };
    },
  };

  return [portfolioReasoning];
}
