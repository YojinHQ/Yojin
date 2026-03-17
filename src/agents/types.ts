/**
 * Agent types — represents an AI agent that processes conversations.
 */

export interface AgentContext {
  providerId: string;
  model: string;
  channelId: string;
  threadId?: string;
  userId: string;
}

export interface ConversationTurn {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

export interface Agent {
  id: string;
  name: string;
  systemPrompt?: string;

  /** Process a conversation turn and return a response. */
  process(
    context: AgentContext,
    history: ConversationTurn[],
    userMessage: string,
  ): Promise<string>;
}
