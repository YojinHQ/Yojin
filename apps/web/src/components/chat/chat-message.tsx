import type { ReactNode } from 'react';
import Markdown from 'react-markdown';
import { cn } from '../../lib/utils';
import type { ToolCardRef } from '../../lib/chat-context';
import ChatAvatar from './chat-avatar';
import ToolRenderer from './tool-cards/tool-renderer';

export interface ChatMessageProps {
  id?: string;
  role: 'assistant' | 'user';
  content?: string;
  children?: ReactNode;
  className?: string;
  piiProtected?: boolean;
  piiTypes?: string[];
  toolCards?: ToolCardRef[];
}

const PII_LABELS: Record<string, string> = {
  EMAIL: 'email',
  PHONE: 'phone',
  SSN: 'SSN',
  CREDIT_CARD: 'card number',
  ADDRESS: 'address',
  NAME: 'name',
};

function formatPiiTypes(types: string[]): string {
  return types.map((t) => PII_LABELS[t] ?? t.toLowerCase()).join(', ');
}

export default function ChatMessage({
  role,
  content,
  children,
  className,
  piiProtected,
  piiTypes,
  toolCards,
}: ChatMessageProps) {
  if (role === 'user') {
    return (
      <div className={cn('flex justify-end', className)}>
        <div className="max-w-[80%] rounded-xl bg-accent-primary px-5 py-2.5">
          <p className="text-sm leading-relaxed text-white">{content ?? children}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex items-start gap-3', className)}>
      <ChatAvatar />
      <div className="min-w-0 max-w-[85%]">
        {children ?? (
          <div className="flex flex-col gap-3">
            {toolCards?.map((card, i) => (
              <ToolRenderer key={`${card.tool}-${i}`} tool={card.tool} params={JSON.parse(card.params)} />
            ))}
            {content && (!toolCards || toolCards.length === 0) && (
              <div className="rounded-xl rounded-tl-sm border border-border bg-bg-card px-4 py-3">
                <div className="prose prose-invert prose-sm max-w-none text-sm leading-relaxed text-text-primary">
                  <Markdown>{content}</Markdown>
                </div>
              </div>
            )}
            {piiProtected && piiTypes && piiTypes.length > 0 && (
              <div className="inline-flex items-center gap-1.5 self-start px-1">
                <svg className="h-3 w-3 text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-[10px] text-emerald-400/80">
                  Your {formatPiiTypes(piiTypes)} was not shared with the AI
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
