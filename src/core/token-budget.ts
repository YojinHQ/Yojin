/**
 * Token budget tracker — estimates token usage and detects when
 * the conversation is approaching the context window limit.
 */

import type { AgentMessage, ContentBlock } from './types.js';

/** Default chars-per-token estimates. */
const CHARS_PER_TOKEN = 4;
const TOOL_RESULT_CHARS_PER_TOKEN = 2; // tool results are more token-dense

/** Safety margin to compensate for underestimation. */
const SAFETY_MARGIN = 1.15;

export interface TokenBudgetConfig {
  /** Total context window in tokens (e.g. 200_000 for Claude). */
  contextWindow: number;
  /** Fraction of context window that triggers compaction (0-1, default 0.9). */
  compactionThreshold: number;
  /** Max fraction of context a single tool result can consume (default 0.3). */
  maxToolResultShare: number;
}

const DEFAULT_CONFIG: TokenBudgetConfig = {
  contextWindow: 200_000,
  compactionThreshold: 0.9,
  maxToolResultShare: 0.3,
};

export class TokenBudget {
  private readonly config: TokenBudgetConfig;

  constructor(config?: Partial<TokenBudgetConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Estimate token count for a string. */
  estimateStringTokens(text: string): number {
    return Math.ceil((text.length / CHARS_PER_TOKEN) * SAFETY_MARGIN);
  }

  /** Estimate token count for a content block. */
  estimateBlockTokens(block: ContentBlock): number {
    switch (block.type) {
      case 'text':
        return this.estimateStringTokens(block.text);
      case 'tool_use':
        // tool name + JSON-serialized input
        return this.estimateStringTokens(block.name + JSON.stringify(block.input));
      case 'tool_result':
        // tool results are more token-dense
        return Math.ceil((block.content.length / TOOL_RESULT_CHARS_PER_TOKEN) * SAFETY_MARGIN);
      case 'image':
        // Anthropic Vision billing is tile-based (512x512 tiles), not file-size-based.
        // Without image dimensions we can't compute tiles, so use a conservative flat
        // estimate (~1600 tokens) rather than the base64 string length which overestimates
        // by 10-100x for typical screenshots and can trigger false compaction.
        return 1600;
    }
  }

  /** Estimate token count for a single message. */
  estimateMessageTokens(message: AgentMessage): number {
    // Role overhead (~4 tokens)
    const overhead = 4;
    if (typeof message.content === 'string') {
      return overhead + this.estimateStringTokens(message.content);
    }
    return overhead + message.content.reduce((sum, block) => sum + this.estimateBlockTokens(block), 0);
  }

  /** Estimate total token count for a message array + optional system prompt. */
  estimateTotal(messages: AgentMessage[], systemPrompt?: string): number {
    let total = messages.reduce((sum, msg) => sum + this.estimateMessageTokens(msg), 0);
    if (systemPrompt) {
      total += this.estimateStringTokens(systemPrompt);
    }
    return total;
  }

  /** Check if compaction should be triggered. */
  shouldCompact(messages: AgentMessage[], systemPrompt?: string): boolean {
    const estimated = this.estimateTotal(messages, systemPrompt);
    const threshold = this.config.contextWindow * this.config.compactionThreshold;
    return estimated >= threshold;
  }

  /** Max chars allowed for a single tool result. */
  maxToolResultChars(): number {
    const maxTokens = this.config.contextWindow * this.config.maxToolResultShare;
    // Convert back from tokens to chars (tool results use denser ratio)
    return Math.floor(maxTokens * TOOL_RESULT_CHARS_PER_TOKEN);
  }

  /** Get the configured context window size. */
  get contextWindow(): number {
    return this.config.contextWindow;
  }

  /** Get remaining token budget. */
  remaining(messages: AgentMessage[], systemPrompt?: string): number {
    return this.config.contextWindow - this.estimateTotal(messages, systemPrompt);
  }
}
