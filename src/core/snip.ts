/**
 * Snip — lightweight pre-compaction pass that strips verbose tool results
 * from older messages to free context space without LLM summarization.
 *
 * Tool results (especially from enrichment, data queries, and scraping) are
 * often very large but their information is already captured in the assistant's
 * subsequent reasoning. Snipping replaces old tool result content with a short
 * placeholder, preserving the tool_use/tool_result structure so the conversation
 * remains valid.
 *
 * This runs BEFORE compaction — it's the cheapest way to recover context space.
 */

import type { TokenBudget } from './token-budget.js';
import type { AgentMessage, ContentBlock, ToolResultBlock } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('snip');

/** Snipped tool results are replaced with this short summary. */
const SNIP_PLACEHOLDER = '[Tool result snipped to save context — see assistant response above for details]';

/** Only snip tool results larger than this threshold (chars). */
const MIN_SNIP_SIZE = 500;

/** Don't snip if we're under this fraction of the context window. */
const SNIP_TRIGGER_THRESHOLD = 0.7;

/**
 * Fire snip when the count of compactable tool results below the preserve
 * boundary exceeds this number, even if estimated context usage is still
 * below the size threshold. Catches the "many small enrichments" pattern
 * common in long curation/insights runs that never trip the 70% trigger
 * until they're near the context limit.
 */
const COUNT_TRIGGER_THRESHOLD = 8;

export interface SnipConfig {
  /** Number of recent user turns to preserve unsnipped (default 5). */
  preserveRecentTurns: number;
}

export interface SnipResult {
  messages: AgentMessage[];
  messagesBefore: number;
  snipped: number;
  /** Which trigger fired the snip pass — useful for telemetry. */
  trigger: 'size' | 'count' | null;
}

/**
 * Snip verbose tool results from older messages.
 *
 * Two triggers fire this pass:
 * - **size**: estimated context usage ≥ 70% of context window
 * - **count**: more than 8 large tool results have piled up below the
 *   preserve boundary (catches long workflows with many small results)
 */
export function snipToolResults(
  messages: AgentMessage[],
  budget: TokenBudget,
  config?: Partial<SnipConfig>,
): SnipResult {
  const preserveRecentTurns = config?.preserveRecentTurns ?? 5;

  // Find the boundary — preserve recent turns
  const splitIndex = findPreserveBoundary(messages, preserveRecentTurns);
  if (splitIndex <= 0) {
    return { messages, messagesBefore: messages.length, snipped: 0, trigger: null };
  }

  // Trigger 1 — size: estimated usage exceeds the size threshold
  const usage = budget.estimateTotal(messages);
  const overSizeThreshold = usage >= budget.contextWindow * SNIP_TRIGGER_THRESHOLD;

  // Trigger 2 — count: too many large tool results piled up below the boundary
  const compactableCount = countCompactableBefore(messages, splitIndex);
  const overCountThreshold = compactableCount > COUNT_TRIGGER_THRESHOLD;

  if (!overSizeThreshold && !overCountThreshold) {
    return { messages, messagesBefore: messages.length, snipped: 0, trigger: null };
  }

  const trigger: 'size' | 'count' = overSizeThreshold ? 'size' : 'count';

  // Snip tool results in old messages (before the preserve boundary)
  let snipped = 0;
  const snippedMessages = messages.map((msg, idx) => {
    if (idx >= splitIndex) return msg; // Preserve recent
    if (typeof msg.content === 'string') return msg;

    const hasToolResults = msg.content.some((b) => b.type === 'tool_result' && b.content.length > MIN_SNIP_SIZE);
    if (!hasToolResults) return msg;

    const newContent: ContentBlock[] = msg.content.map((block) => {
      if (block.type !== 'tool_result') return block;
      if (block.content.length <= MIN_SNIP_SIZE) return block;

      snipped++;
      return {
        ...block,
        content: SNIP_PLACEHOLDER,
      } as ToolResultBlock;
    });

    return { ...msg, content: newContent };
  });

  if (snipped > 0) {
    logger.info('Snipped tool results', { snipped, splitIndex, trigger, messageCount: messages.length });
  }

  return {
    messages: snippedMessages,
    messagesBefore: messages.length,
    snipped,
    trigger: snipped > 0 ? trigger : null,
  };
}

/**
 * Count compactable (large enough to snip) tool_result blocks in the message
 * range [0, splitIndex). Used by the count-based trigger.
 */
function countCompactableBefore(messages: AgentMessage[], splitIndex: number): number {
  let count = 0;
  for (let i = 0; i < splitIndex; i++) {
    const msg = messages[i];
    if (typeof msg.content === 'string') continue;
    for (const block of msg.content) {
      if (block.type === 'tool_result' && block.content.length > MIN_SNIP_SIZE) {
        count++;
      }
    }
  }
  return count;
}

/**
 * Find the index where we start preserving messages (everything at or after
 * this index is kept unsnipped). Walks backwards counting user messages.
 */
function findPreserveBoundary(messages: AgentMessage[], preserveTurns: number): number {
  let userCount = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      userCount++;
      if (userCount >= preserveTurns) {
        return i;
      }
    }
  }
  return 0;
}
