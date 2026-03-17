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

/**
 * Safe recursive-descent math parser. Supports: +, -, *, /, %, ** (^),
 * parentheses, and unary minus. No eval/Function — no code execution risk.
 */
function evaluateMath(expr: string): number {
  let pos = 0;
  const input = expr.replace(/\s+/g, '');

  function parseExpression(): number {
    let left = parseTerm();
    while (pos < input.length && (input[pos] === '+' || input[pos] === '-')) {
      const op = input[pos++];
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  function parseTerm(): number {
    let left = parseExponent();
    while (pos < input.length && (input[pos] === '*' || input[pos] === '/' || input[pos] === '%')) {
      const op = input[pos++];
      const right = parseExponent();
      if (op === '*') left *= right;
      else if (op === '/') left /= right;
      else left %= right;
    }
    return left;
  }

  function parseExponent(): number {
    let base = parseUnary();
    while (
      pos < input.length &&
      (input[pos] === '^' || (input[pos] === '*' && input[pos + 1] === '*'))
    ) {
      if (input[pos] === '*') pos += 2;
      else pos++;
      const exp = parseUnary();
      base = Math.pow(base, exp);
    }
    return base;
  }

  function parseUnary(): number {
    if (input[pos] === '-') {
      pos++;
      return -parseUnary();
    }
    if (input[pos] === '+') {
      pos++;
      return parseUnary();
    }
    return parsePrimary();
  }

  function parsePrimary(): number {
    if (input[pos] === '(') {
      pos++; // skip '('
      const value = parseExpression();
      if (input[pos] !== ')') throw new Error('Missing closing parenthesis');
      pos++; // skip ')'
      return value;
    }
    // Parse number (including decimals and scientific notation)
    const start = pos;
    while (pos < input.length && ((input[pos] >= '0' && input[pos] <= '9') || input[pos] === '.')) {
      pos++;
    }
    // Handle scientific notation (e.g., 1e10, 2.5e-3)
    if (pos < input.length && (input[pos] === 'e' || input[pos] === 'E')) {
      pos++;
      if (pos < input.length && (input[pos] === '+' || input[pos] === '-')) pos++;
      while (pos < input.length && input[pos] >= '0' && input[pos] <= '9') pos++;
    }
    if (pos === start) throw new Error(`Unexpected character: ${input[pos] ?? 'end of input'}`);
    return Number(input.slice(start, pos));
  }

  const result = parseExpression();
  if (pos < input.length) throw new Error(`Unexpected character at position ${pos}: ${input[pos]}`);
  return result;
}

export const calculateTool: ToolDefinition = {
  name: 'calculate',
  description:
    'Evaluate a mathematical expression. Supports basic arithmetic: +, -, *, /, **, %, parentheses.',
  parameters: z.object({
    expression: z.string().describe('The mathematical expression to evaluate, e.g. "2 + 3 * 4"'),
  }),
  execute: async ({ expression }) => {
    try {
      const result = evaluateMath(expression);
      if (typeof result !== 'number' || !isFinite(result)) {
        return { content: `Result is not a finite number`, isError: true };
      }
      return { content: String(result) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: `Failed to evaluate: ${msg}`, isError: true };
    }
  },
};

export const starterTools: ToolDefinition[] = [getCurrentTimeTool, calculateTool];
