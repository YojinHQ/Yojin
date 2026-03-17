interface ChatMessageProps {
  id: string;
  role: 'assistant' | 'user';
  content: string;
}

export default function ChatMessage({ role, content }: ChatMessageProps) {
  if (role === 'assistant') {
    return (
      <div className="flex gap-3">
        <img src="/yojin_inverse_avatar.png" alt="Yojin" className="h-8 w-8 flex-shrink-0 rounded-full object-cover" />
        <div className="bg-bg-card border-border max-w-[80%] rounded-2xl rounded-tl-sm border px-4 py-3">
          <p className="text-text-primary text-sm leading-relaxed">{content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-end gap-3">
      <div className="bg-accent-primary/10 border-accent-primary/20 max-w-[80%] rounded-2xl rounded-tr-sm border px-4 py-3">
        <p className="text-text-primary text-sm leading-relaxed">{content}</p>
      </div>
      <div className="bg-bg-tertiary text-text-secondary flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-medium">
        DS
      </div>
    </div>
  );
}
