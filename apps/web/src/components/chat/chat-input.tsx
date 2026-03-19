import { useCallback, useRef, useState } from 'react';
import Button from '../common/button';
import type { ChatImageData } from '../../lib/chat-context';

export interface ImageAttachment extends ChatImageData {
  preview: string;
  name: string;
}

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAX_SIZE_MB = 10;

export default function ChatInput({
  onSend,
  disabled,
}: {
  onSend: (message: string, image?: ImageAttachment) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState('');
  const [image, setImage] = useState<ImageAttachment | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Shared logic: validate a File and read it as an ImageAttachment. */
  const processFile = useCallback((file: File) => {
    if (!ACCEPTED_TYPES.has(file.type)) {
      alert(`Unsupported file type: ${file.type}. Accepted: JPEG, PNG, GIF, WebP.`);
      return;
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      alert(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum size is ${MAX_SIZE_MB} MB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      setImage({
        base64,
        mediaType: file.type as ImageAttachment['mediaType'],
        preview: dataUrl,
        name: file.name,
      });
    };
    reader.onerror = () => {
      alert('Failed to read the image file. Please try again.');
    };
    reader.readAsDataURL(file);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((!value.trim() && !image) || disabled) return;
    onSend(value.trim() || (image ? 'Analyze this image.' : ''), image ?? undefined);
    setValue('');
    setImage(null);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    // Reset input so the same file can be re-selected
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) processFile(file);
        return;
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  return (
    <div onDrop={handleDrop} onDragOver={handleDragOver} onPaste={handlePaste}>
      {image && (
        <div className="bg-bg-card border-border mb-2 flex items-center gap-3 rounded-lg border px-3 py-2">
          <img src={image.preview} alt={image.name} className="h-12 w-12 rounded object-cover" />
          <span className="text-text-secondary flex-1 truncate text-xs">{image.name}</span>
          <button
            type="button"
            onClick={() => setImage(null)}
            className="text-text-muted hover:text-text-primary text-sm"
            aria-label="Remove image"
          >
            &times;
          </button>
        </div>
      )}
      <form
        onSubmit={handleSubmit}
        className="bg-bg-card border-border flex items-center gap-3 rounded-xl border px-4 py-3"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          onChange={handleFileSelect}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="text-text-muted hover:text-text-primary flex-shrink-0 transition-colors"
          title="Upload image"
          disabled={disabled}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path
              fillRule="evenodd"
              d="M15.621 4.379a3 3 0 0 0-4.242 0l-7 7a3 3 0 0 0 4.241 4.243h.001l.497-.5a.75.75 0 0 1 1.064 1.057l-.498.501a4.5 4.5 0 0 1-6.364-6.364l7-7a4.5 4.5 0 0 1 6.368 6.36l-3.455 3.553A2.625 2.625 0 1 1 9.52 9.52l3.45-3.451a.75.75 0 1 1 1.061 1.06l-3.45 3.451a1.125 1.125 0 0 0 1.587 1.595l3.454-3.553a3 3 0 0 0 0-4.242Z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onPaste={handlePaste}
          placeholder={image ? 'Add a message or send the image...' : 'Ask Yojin anything about your portfolio...'}
          className="text-text-primary placeholder:text-text-muted flex-1 bg-transparent text-sm outline-none"
        />
        <Button type="submit" disabled={(!value.trim() && !image) || disabled}>
          Send
        </Button>
      </form>
    </div>
  );
}
