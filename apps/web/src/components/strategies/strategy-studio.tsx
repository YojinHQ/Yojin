import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useSubscription } from 'urql';

import { SEND_MESSAGE_MUTATION, CHAT_SUBSCRIPTION } from '../../lib/chat-documents.js';
import type { ChatMessage as ChatMsg, ChatEvent, ToolCardRef } from '../../lib/chat-context.js';
import { cn } from '../../lib/utils.js';
import Modal from '../common/modal.js';
import ChatMessageComponent from '../chat/chat-message.js';
import ChatInput from '../chat/chat-input.js';
import { SuggestionChips } from './suggestion-chips.js';
import { StrategyFormPanel } from './strategy-form-panel.js';
import type { StrategyFormData } from './strategy-form-panel.js';
import type { Strategy } from './types.js';

export interface StrategyStudioProps {
  open: boolean;
  onClose: () => void;
  strategy?: Strategy | null;
  editMode?: boolean;
}

/** Strategy Studio thread prefix — sessions starting with this are filtered from the sidebar. */
export const STRATEGY_STUDIO_PREFIX = 'strategy-studio-';

function createEmptyForm(): StrategyFormData {
  return {
    name: '',
    description: '',
    category: 'MARKET',
    style: '',
    requires: [],
    content: '',
    triggerGroups: [
      {
        id: crypto.randomUUID(),
        label: '',
        conditions: [{ id: crypto.randomUUID(), type: 'PRICE_MOVE', description: '', params: {} }],
      },
    ],
    tickers: [],
    maxPositionSize: undefined,
    targetAllocation: undefined,
    targetWeights: [],
  };
}

function parseTargetWeights(raw: string | null | undefined): { ticker: string; weight: number }[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    return Object.entries(parsed as Record<string, unknown>)
      .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
      .map(([ticker, weight]) => ({ ticker, weight: weight as number }));
  } catch {
    return [];
  }
}

function parseParams(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function strategyToFormData(strategy: Strategy): StrategyFormData {
  return {
    name: strategy.name,
    description: strategy.description,
    category: strategy.category,
    style: strategy.style,
    // Keep uppercase (matches form CAPABILITIES); GraphQL resolver handles case conversion
    requires: [...strategy.requires],
    content: strategy.content,
    triggerGroups: strategy.triggerGroups.map((g) => ({
      id: crypto.randomUUID(),
      label: g.label ?? '',
      conditions: g.conditions.map((t) => ({
        id: crypto.randomUUID(),
        type: t.type,
        description: t.description,
        params: parseParams(t.params),
      })),
    })),
    tickers: [...strategy.tickers],
    maxPositionSize: strategy.maxPositionSize ?? undefined,
    targetAllocation: strategy.targetAllocation ?? undefined,
    targetWeights: parseTargetWeights(strategy.targetWeights),
  };
}

const CREATE_PROMPT =
  '[STRATEGY STUDIO — CREATE MODE]\n' +
  'Help me create a new trading strategy. Ask clarifying questions to understand my goal — ' +
  'what I want to capture or protect against, which assets, what thresholds.\n\n' +
  'Recognize which archetype I am aiming for:\n' +
  '- **Technical:** indicator/price-based. Available indicator keys for `INDICATOR_THRESHOLD` triggers: ' +
  '`RSI`, `MFI`, `WILLIAMS_R`, `STOCH_K`, `STOCH_D`, ' +
  '`MACD` (histogram), `MACD_LINE`, `MACD_SIGNAL`, ' +
  '`EMA`, `EMA_50`, `EMA_200`, `SMA` (50), `SMA_20`, `SMA_200`, `WMA_52`, `VWMA`, `VWAP`, ' +
  '`BB_UPPER`, `BB_MIDDLE`, `BB_LOWER`, `BB_WIDTH`, ' +
  '`ATR`, `ADX`, `PSAR`, `OBV`, ' +
  '`GOLDEN_CROSS`, `DEATH_CROSS`, `EMA_CROSS` (crossover flags — 1 when active; use threshold `1` with direction `above`). ' +
  'Also consider `PRICE_MOVE` and `DRAWDOWN` triggers. If my intent maps to an existing template, propose forking it.\n' +
  '- **Copy Trading:** "trade like [person/fund]". CRITICAL: search for the EXACT investor/fund the user named — never substitute a different one. Use `search_entities` to find that specific fund, then `get_institutional_holdings` with their CIK to fetch their real 13F portfolio. Use the actual holdings to populate the strategy ticker list and inform triggers. If the user says "Buffett", look up Berkshire Hathaway — not ARK, not any other fund.\n' +
  '- **Index Replication / Thematic Allocation:** "build me [index/theme]" or "put X% in [theme]". Suggest a concrete basket of companies with weight targets and concentration drift triggers.\n\n' +
  'Once you have enough information, call `display_propose_strategy` with a complete strategy. ' +
  "Generate a full markdown body (thesis, entry/exit rules, risk management) — don't leave it to the user.";

const EDIT_PROMPT_PREFIX =
  '[STRATEGY STUDIO — EDIT MODE]\n' +
  'I want to edit this strategy. Help me refine it — I can edit the form directly or ask you for changes. ' +
  'When I ask for modifications, call `display_propose_strategy` with the updated strategy. ' +
  'You can also proactively suggest improvements.\n\nCurrent strategy: ';

const FORK_PROMPT_PREFIX =
  '[STRATEGY STUDIO — FORK MODE]\n' +
  'I want to fork this strategy as a starting point for a new one. ' +
  'Help me customize it. When I ask for changes, call `display_propose_strategy` with the updated strategy.\n\nOriginal strategy: ';

function buildInitialMessage(strategy: Strategy | null | undefined, editMode: boolean | undefined): string {
  if (!strategy) return CREATE_PROMPT;
  const data = JSON.stringify(strategyToFormData(strategy));
  if (editMode) return `${EDIT_PROMPT_PREFIX}${data}`;
  return `${FORK_PROMPT_PREFIX}${data}`;
}

export function StrategyStudio({ open, onClose, strategy, editMode }: StrategyStudioProps) {
  const [threadId] = useState(() => `${STRATEGY_STUDIO_PREFIX}${Date.now()}`);

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState<StrategyFormData>(() =>
    strategy ? strategyToFormData(strategy) : createEmptyForm(),
  );
  const [formVisible, setFormVisible] = useState(() => !!strategy);

  const [mutationError, setMutationError] = useState<string | null>(null);
  const completedIdsRef = useRef(new Set<string>());
  const toolCardsRef = useRef<ToolCardRef[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasSentInitialRef = useRef(false);

  const [, sendMessageMutation] = useMutation(SEND_MESSAGE_MUTATION);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, scrollToBottom]);

  // Pure accumulator — no side effects. Events are processed in the useEffect below.
  const handleSubscription = useCallback(
    (prev: ChatEvent[] | undefined, data: { onChatMessage: ChatEvent }): ChatEvent[] => {
      return [...(prev ?? []), data.onChatMessage];
    },
    [],
  );

  const [{ data: subscriptionData }] = useSubscription(
    { query: CHAT_SUBSCRIPTION, variables: { threadId }, pause: !open },
    handleSubscription,
  );

  const processedCountRef = useRef(0);

  const handleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const events: ChatEvent[] = subscriptionData ?? [];
    const toProcess = events.slice(processedCountRef.current);
    if (toProcess.length === 0) return;
    processedCountRef.current = events.length;

    handleTimeoutRef.current = setTimeout(() => {
      for (const event of toProcess) {
        if (event.type === 'THINKING') {
          setIsLoading(true);
        } else if (event.type === 'TOOL_CARD' && event.toolCard) {
          const card = event.toolCard;
          const isDuplicate = toolCardsRef.current.some((c) => c.tool === card.tool && c.params === card.params);
          if (!isDuplicate) {
            toolCardsRef.current.push(card);
          }
          if (card.tool === 'propose-strategy') {
            try {
              const proposed = JSON.parse(card.params) as Partial<StrategyFormData>;
              // Ensure condition.params is always an object (server may send undefined)
              if (proposed.triggerGroups) {
                proposed.triggerGroups = proposed.triggerGroups.map((g) => ({
                  ...g,
                  id: crypto.randomUUID(),
                  label: g.label ?? '',
                  conditions: g.conditions.map((c) => ({ ...c, id: crypto.randomUUID(), params: c.params ?? {} })),
                }));
              }
              // GraphQL returns uppercase capabilities; normalize for form
              if (proposed.requires) {
                proposed.requires = proposed.requires.map((r) => r.toUpperCase());
              }
              // The LLM may emit targetWeights as a Record<ticker, weight> — normalize to the array shape.
              const rawWeights = (proposed as { targetWeights?: unknown }).targetWeights;
              if (rawWeights && !Array.isArray(rawWeights) && typeof rawWeights === 'object') {
                proposed.targetWeights = Object.entries(rawWeights as Record<string, unknown>)
                  .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
                  .map(([ticker, weight]) => ({ ticker: ticker.toUpperCase(), weight: weight as number }));
              }
              setFormData((prev) => ({ ...prev, ...proposed }));
              setFormVisible(true);
            } catch (err) {
              console.error('Failed to parse strategy proposal params', err);
            }
          }
        } else if (event.type === 'TEXT_DELTA') {
          setIsLoading(false);
          if (event.accumulatedText != null) {
            setStreamingContent(event.accumulatedText);
          } else if (event.delta != null) {
            setStreamingContent((prev) => prev + event.delta);
          }
        } else if (event.type === 'MESSAGE_COMPLETE') {
          const msgId = event.messageId ?? crypto.randomUUID();
          if (completedIdsRef.current.has(msgId)) continue;
          completedIdsRef.current.add(msgId);
          const toolCards = toolCardsRef.current.length > 0 ? [...toolCardsRef.current] : undefined;
          setMessages((prev) => [...prev, { id: msgId, role: 'assistant', content: event.content ?? '', toolCards }]);
          setStreamingContent('');
          setIsLoading(false);
          toolCardsRef.current = [];
        } else if (event.type === 'ERROR') {
          if (event.messageId) {
            if (completedIdsRef.current.has(event.messageId)) continue;
            completedIdsRef.current.add(event.messageId);
          }
          setMessages((prev) => [
            ...prev,
            {
              id: event.messageId ?? crypto.randomUUID(),
              role: 'assistant',
              content: `Something went wrong. ${event.error ?? ''}`,
            },
          ]);
          setStreamingContent('');
          setIsLoading(false);
          toolCardsRef.current = [];
        }
      }
    }, 0);

    return () => {
      if (handleTimeoutRef.current !== null) clearTimeout(handleTimeoutRef.current);
    };
  }, [subscriptionData]);

  useEffect(() => {
    if (!open || hasSentInitialRef.current) return;
    hasSentInitialRef.current = true;
    const handle = setTimeout(() => setIsLoading(true), 0);
    const msg = buildInitialMessage(strategy, editMode);
    void (async () => {
      const result = await sendMessageMutation({ threadId, message: msg });
      if (result.error) {
        setMutationError(result.error.message);
        setIsLoading(false);
      }
    })();
    return () => clearTimeout(handle);
  }, [open, strategy, editMode, threadId, sendMessageMutation]);

  const handleSend = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;
      setMutationError(null);
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', content: text }]);
      setIsLoading(true);
      setStreamingContent('');
      toolCardsRef.current = [];
      const result = await sendMessageMutation({ threadId, message: text });
      if (result.error) {
        setMutationError(result.error.message);
        setIsLoading(false);
      }
    },
    [threadId, sendMessageMutation, isLoading],
  );

  const handleChipSelect = useCallback(
    (text: string) => {
      handleSend(text);
    },
    [handleSend],
  );

  const handleSaved = useCallback(() => {
    onClose();
  }, [onClose]);

  const showChips = !messages.some((m) => m.role === 'user');

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-6xl" className="flex h-[85vh] flex-col overflow-hidden p-0">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h2 className="font-headline text-base text-text-primary">Strategy Studio</h2>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer text-text-muted transition-colors hover:text-text-primary"
          aria-label="Close"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Body: Chat (left) + Form (right) */}
      <div className="flex flex-1 overflow-hidden">
        {/* Chat Panel */}
        <div className={cn('flex flex-col', formVisible ? 'w-2/5 border-r border-border' : 'w-full')}>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {messages.map((msg) => (
              <ChatMessageComponent key={msg.id} role={msg.role} content={msg.content} toolCards={msg.toolCards} />
            ))}
            {streamingContent && <ChatMessageComponent role="assistant" content={streamingContent} streaming />}
            {isLoading && !streamingContent && (
              <div className="flex items-center gap-1.5 py-2">
                <span className="h-2 w-2 animate-pulse rounded-full bg-text-muted" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-text-muted [animation-delay:150ms]" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-text-muted [animation-delay:300ms]" />
              </div>
            )}
            {mutationError && (
              <div className="rounded-lg bg-error/10 border border-error/30 px-4 py-2 text-sm text-error">
                {mutationError}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Suggestion Chips + Input */}
          <div className="border-t border-border px-4 py-3">
            {showChips && <SuggestionChips onSelect={handleChipSelect} />}
            <ChatInput
              onSend={handleSend}
              disabled={isLoading}
              disableAttachment
              placeholder="Describe your strategy idea..."
            />
          </div>
        </div>

        {/* Form Panel */}
        {formVisible && (
          <div className="w-3/5">
            <StrategyFormPanel
              data={formData}
              onChange={setFormData}
              editId={editMode && strategy ? strategy.id : undefined}
              onSaved={handleSaved}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
