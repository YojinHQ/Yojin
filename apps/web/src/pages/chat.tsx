import { useCallback, useRef, useState, useEffect } from 'react';
import MorningBriefing from '../components/chat/morning-briefing';
import QueryBuilder from '../components/chat/query-builder';
import ChatInput from '../components/chat/chat-input';
import ChatMessage from '../components/chat/chat-message';

interface Message {
  id: string;
  role: 'assistant' | 'user';
  content: string;
}

const MOCK_RESPONSES: Record<string, string> = {
  'How is my portfolio performing today?':
    'Your portfolio is up 1.2% today, outperforming the S&P 500 by 0.4%. Your top mover is NVDA (+3.8%) while AAPL is slightly down (-0.3%). Overall, your positions are well-balanced with no immediate concerns.',
  'Analyze my current risk exposure':
    'Your current risk exposure is moderate. Tech sector concentration is at 42%, which is above the recommended 30% threshold. Consider diversifying into healthcare or energy. Your max drawdown risk is estimated at 12.5% based on current volatility.',
  'Show me my top performing positions':
    'Your top 3 performers this month: 1) NVDA +18.4% 2) META +12.1% 3) AMZN +8.7%. Together they represent 35% of your portfolio and have contributed 78% of your total gains this period.',
  'What market trends should I watch?':
    'Key trends to watch: 1) Fed rate decision next week - markets pricing in a hold. 2) AI infrastructure spending accelerating - positive for your NVDA and MSFT positions. 3) Oil prices declining - could benefit consumer discretionary holdings.',
};

function getMockResponse(userMessage: string): string {
  return (
    MOCK_RESPONSES[userMessage] ??
    `I've analyzed your question about "${userMessage}". Based on your current portfolio composition and market conditions, I'd recommend reviewing your positions in the context of recent sector rotations. Would you like me to dive deeper into any specific aspect?`
  );
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleSend = useCallback((content: string) => {
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
    };
    setMessages((prev) => [...prev, userMessage]);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: getMockResponse(content),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    }, 800);
  }, []);

  const handleQuerySelect = useCallback(
    (query: string) => {
      handleSend(query);
    },
    [handleSend],
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Messages area - scrollable */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          <MorningBriefing />
          {messages.map((msg) => (
            <ChatMessage key={msg.id} id={msg.id} role={msg.role} content={msg.content} />
          ))}
        </div>
      </div>

      {/* Query builder - shown when no messages yet */}
      {messages.length === 0 && (
        <div className="px-6 pb-2">
          <div className="mx-auto max-w-3xl">
            <QueryBuilder onSelect={handleQuerySelect} />
          </div>
        </div>
      )}

      {/* Chat input - pinned bottom */}
      <div className="px-6 pb-6">
        <div className="mx-auto max-w-3xl">
          <ChatInput onSend={handleSend} />
        </div>
      </div>
    </div>
  );
}
