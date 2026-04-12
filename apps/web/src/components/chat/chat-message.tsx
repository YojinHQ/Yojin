import type { ReactNode } from 'react';
import Markdown from 'react-markdown';
import { cn } from '../../lib/utils';
import type { ToolCardRef } from '../../lib/chat-context';
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
  streaming?: boolean;
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

const AUTH_EXPIRED_TAG = '[AUTH_EXPIRED]';

function AuthExpiredCard() {
  return (
    <div className="rounded-xl rounded-tl-sm border border-amber-500/30 bg-amber-950/20 px-4 py-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15">
          <svg className="h-4 w-4 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-amber-300">Session expired</p>
          <p className="mt-1 text-sm leading-relaxed text-amber-200/70">
            Your Claude authentication token has expired. Please re-authenticate by running{' '}
            <code className="rounded bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-300">pnpm setup-token</code> in
            your terminal, then try again.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function ChatMessage({
  role,
  content,
  children,
  className,
  piiProtected,
  piiTypes,
  toolCards,
  streaming,
}: ChatMessageProps) {
  const isAuthExpired = content === AUTH_EXPIRED_TAG;

  if (role === 'user') {
    return (
      <div className={cn('flex justify-end', className)}>
        <div className="chat-user-bubble max-w-[80%] rounded-xl px-5 py-2.5">
          <p className="text-base leading-relaxed text-text-primary">{content ?? children}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('w-full', className)}>
      {children ?? (
        <div className="flex flex-col gap-3">
          {toolCards?.map((card, i) => (
            <ToolRenderer key={`${card.tool}-${i}`} tool={card.tool} params={JSON.parse(card.params)} />
          ))}
          {isAuthExpired && <AuthExpiredCard />}
          {content && !isAuthExpired && (!toolCards || toolCards.length === 0) && (
            <div className="chat-assistant-prose prose prose-invert max-w-none text-base leading-7 prose-headings:mb-2 prose-headings:mt-6 prose-p:my-3.5 prose-li:my-1 prose-a:break-all prose-a:text-success prose-a:no-underline hover:prose-a:underline prose-code:rounded prose-code:px-1.5 prose-code:py-0.5 prose-code:text-sm prose-code:before:content-none prose-code:after:content-none prose-pre:rounded-xl prose-pre:text-sm">
              <Markdown>{streaming ? `${content}▍` : content}</Markdown>
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
  );
}
