/**
 * Tool result truncation — caps oversized tool results using a head+tail
 * strategy that preserves error output at the end.
 */

const DEFAULT_MAX_CHARS = 50_000;
const HEAD_RATIO = 0.7;
const TAIL_RATIO = 0.3;
const OMISSION_MARKER = '\n\n[... content truncated — showing first and last portions ...]\n\n';

export interface TruncationConfig {
  /** Max chars for a single tool result (default 50_000). */
  maxChars: number;
}

/**
 * Truncate a tool result string if it exceeds maxChars.
 * Uses head+tail strategy: keeps first 70% and last 30% of the budget,
 * preserving error messages that typically appear at the end.
 */
export function truncateToolResult(
  content: string,
  config?: Partial<TruncationConfig>,
): { content: string; wasTruncated: boolean } {
  const maxChars = config?.maxChars ?? DEFAULT_MAX_CHARS;

  if (content.length <= maxChars) {
    return { content, wasTruncated: false };
  }

  const budget = maxChars - OMISSION_MARKER.length;
  if (budget <= 0) {
    return { content: content.slice(0, maxChars), wasTruncated: true };
  }

  const headSize = Math.floor(budget * HEAD_RATIO);
  const tailSize = Math.floor(budget * TAIL_RATIO);

  const head = content.slice(0, headSize);
  const tail = content.slice(content.length - tailSize);

  return {
    content: head + OMISSION_MARKER + tail,
    wasTruncated: true,
  };
}

/**
 * Apply truncation to all tool results in a ToolCallResult array.
 * Mutates the result content in place for efficiency.
 */
export function truncateToolResults(
  results: Array<{ result: { content: string; isError?: boolean } }>,
  config?: Partial<TruncationConfig>,
): number {
  let truncatedCount = 0;
  for (const entry of results) {
    const { content, wasTruncated } = truncateToolResult(entry.result.content, config);
    if (wasTruncated) {
      entry.result.content = content;
      truncatedCount++;
    }
  }
  return truncatedCount;
}
