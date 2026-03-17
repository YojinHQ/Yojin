/**
 * Context compaction — summarizes older conversation messages when
 * approaching the context window limit, preserving recent turns verbatim.
 */

import type { AgentLoopProvider, AgentMessage, TextBlock } from './types.js';
import type { TokenBudget } from './token-budget.js';

export interface CompactionConfig {
  /** Number of recent user/assistant turn pairs to preserve verbatim (default 3). */
  preserveRecentTurns: number;
}

const DEFAULT_CONFIG: CompactionConfig = {
  preserveRecentTurns: 3,
};

const COMPACTION_SYSTEM_PROMPT = `You are a conversation summarizer. Your job is to create a structured summary of the conversation history that preserves all critical information.

Your summary MUST include these sections:

## Decisions
Key decisions made during the conversation.

## Open TODOs
Tasks or questions that are still pending.

## Constraints/Rules
Any rules, constraints, or important context established.

## Recent Context
What was the user working on most recently? What was the last topic of discussion?

## Key Identifiers
Any specific names, IDs, URLs, file paths, or values that were referenced.

Rules:
- Be concise but preserve ALL actionable information.
- Include exact identifiers (file paths, variable names, URLs) — do not paraphrase these.
- Prioritize recent context over older history.
- If the conversation involved tool calls, note what tools were used and their key results.`;

export interface CompactionResult {
  /** The compacted message array (summary + preserved recent turns). */
  messages: AgentMessage[];
  /** Number of messages before compaction. */
  messagesBefore: number;
  /** Number of messages after compaction. */
  messagesAfter: number;
  /** Whether LLM summarization was used (false = hard trim fallback). */
  usedLlmSummary: boolean;
}

/**
 * Compact conversation history by summarizing older messages and
 * preserving the most recent turns verbatim.
 */
export async function compactMessages(
  messages: AgentMessage[],
  provider: AgentLoopProvider,
  model: string,
  budget: TokenBudget,
  config?: Partial<CompactionConfig>,
): Promise<CompactionResult> {
  const { preserveRecentTurns } = { ...DEFAULT_CONFIG, ...config };
  const messagesBefore = messages.length;

  // Find the split point: preserve last N user turns and their responses
  const splitIndex = findSplitIndex(messages, preserveRecentTurns);

  // If there's nothing to compact (conversation is too short), return as-is
  if (splitIndex <= 0) {
    return {
      messages,
      messagesBefore,
      messagesAfter: messages.length,
      usedLlmSummary: false,
    };
  }

  const oldMessages = messages.slice(0, splitIndex);
  const recentMessages = messages.slice(splitIndex);

  // Try LLM-based summarization
  try {
    const summary = await summarizeWithLlm(oldMessages, provider, model);
    const compactedMessages: AgentMessage[] = [
      { role: 'user', content: `[Previous conversation summary]\n\n${summary}` },
      {
        role: 'assistant',
        content: [
          {
            type: 'text' as const,
            text: 'Understood. I have the context from our previous conversation. How can I help?',
          },
        ],
      },
      ...recentMessages,
    ];

    // Verify compaction actually reduced size
    if (budget.estimateTotal(compactedMessages) < budget.estimateTotal(messages)) {
      return {
        messages: compactedMessages,
        messagesBefore,
        messagesAfter: compactedMessages.length,
        usedLlmSummary: true,
      };
    }
  } catch {
    // Fall through to hard trim
  }

  // Fallback: hard trim — just keep recent messages
  return {
    messages: recentMessages,
    messagesBefore,
    messagesAfter: recentMessages.length,
    usedLlmSummary: false,
  };
}

/**
 * Find the index where we split old messages from recent preserved turns.
 * Walks backwards counting user messages to preserve N complete turn pairs.
 */
function findSplitIndex(messages: AgentMessage[], preserveTurns: number): number {
  let userCount = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      userCount++;
      if (userCount >= preserveTurns) {
        return i;
      }
    }
  }
  // Not enough turns to split — can't compact
  return 0;
}

/**
 * Summarize messages using the LLM provider.
 */
async function summarizeWithLlm(
  messages: AgentMessage[],
  provider: AgentLoopProvider,
  model: string,
): Promise<string> {
  // Build a text representation of the conversation for summarization
  const conversationText = messages
    .map((msg) => {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      const text =
        typeof msg.content === 'string'
          ? msg.content
          : msg.content
              .map((block) => {
                if (block.type === 'text') return block.text;
                if (block.type === 'tool_use') return `[Called tool: ${block.name}]`;
                if (block.type === 'tool_result')
                  return `[Tool result: ${block.content.slice(0, 500)}${block.content.length > 500 ? '...' : ''}]`;
                return '';
              })
              .filter(Boolean)
              .join('\n');
      return `${role}: ${text}`;
    })
    .join('\n\n');

  const response = await provider.completeWithTools({
    model,
    system: COMPACTION_SYSTEM_PROMPT,
    maxTokens: 2048,
    messages: [
      {
        role: 'user',
        content: `Please summarize the following conversation:\n\n${conversationText}`,
      },
    ],
  });

  const textBlocks = response.content.filter((b): b is TextBlock => b.type === 'text');
  return textBlocks.map((b) => b.text).join('');
}
