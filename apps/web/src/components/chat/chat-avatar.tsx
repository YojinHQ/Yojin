import { cn } from '../../lib/utils';

interface ChatAvatarProps {
  className?: string;
}

export default function ChatAvatar({ className }: ChatAvatarProps) {
  return (
    <div
      className={cn(
        'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-accent-primary text-sm font-semibold text-white',
        className,
      )}
    >
      Y
    </div>
  );
}
