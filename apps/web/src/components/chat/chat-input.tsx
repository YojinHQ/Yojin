import { useState } from 'react';
import Button from '../common/button';

export default function ChatInput({ onSend }: { onSend: (message: string) => void }) {
  const [value, setValue] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    onSend(value.trim());
    setValue('');
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-bg-card border-border flex items-center gap-3 rounded-xl border px-4 py-3"
    >
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ask Yojin anything about your portfolio..."
        className="text-text-primary placeholder:text-text-muted flex-1 bg-transparent text-sm outline-none"
      />
      <Button type="submit" disabled={!value.trim()}>
        Send
      </Button>
    </form>
  );
}
