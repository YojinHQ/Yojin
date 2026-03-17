/**
 * Starter tools — simple tools for testing the agent loop end-to-end.
 */

import { z } from 'zod';
import type { ToolDefinition } from './types.js';

export const getCurrentTimeTool: ToolDefinition = {
  name: 'get_current_time',
  description: 'Get the current date and time in ISO format.',
  parameters: z.object({}),
  execute: async () => ({
    content: new Date().toISOString(),
  }),
};

export const calculateTool: ToolDefinition = {
  name: 'calculate',
  description:
    'Evaluate a mathematical expression. Supports basic arithmetic: +, -, *, /, **, %, parentheses.',
  parameters: z.object({
    expression: z.string().describe('The mathematical expression to evaluate, e.g. "2 + 3 * 4"'),
  }),
  execute: async ({ expression }) => {
    // Only allow safe math characters
    if (!/^[\d\s+\-*/().%^e]+$/i.test(expression)) {
      return { content: `Invalid expression: ${expression}`, isError: true };
    }
    try {
      // Replace ^ with ** for exponentiation
      const sanitized = expression.replace(/\^/g, '**');
      const result = new Function(`"use strict"; return (${sanitized})`)() as number;
      if (typeof result !== 'number' || !isFinite(result)) {
        return { content: `Result is not a finite number`, isError: true };
      }
      return { content: String(result) };
    } catch {
      return { content: `Failed to evaluate: ${expression}`, isError: true };
    }
  },
};

export const starterTools: ToolDefinition[] = [getCurrentTimeTool, calculateTool];
