/**
 * Global chat panel state — controls size and preset messages.
 *
 * Three modes: collapsed (hidden), panel (side panel), full (full page).
 */

import { createContext, useCallback, useContext, useState } from 'react';

export type ChatPanelMode = 'collapsed' | 'panel' | 'full';

interface ChatPanelContextValue {
  mode: ChatPanelMode;
  isOpen: boolean;
  presetMessage: string | undefined;
  openChat: () => void;
  openChatWith: (message: string) => void;
  toggleChat: () => void;
  setMode: (mode: ChatPanelMode) => void;
  consumePreset: () => void;
}

const ChatPanelContext = createContext<ChatPanelContextValue | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useChatPanel(): ChatPanelContextValue {
  const ctx = useContext(ChatPanelContext);
  if (!ctx) throw new Error('useChatPanel must be used within ChatPanelProvider');
  return ctx;
}

export function ChatPanelProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ChatPanelMode>('panel');
  const [presetMessage, setPresetMessage] = useState<string | undefined>();

  const isOpen = mode !== 'collapsed';

  const openChat = useCallback(() => setModeState('panel'), []);

  const toggleChat = useCallback(() => setModeState((prev) => (prev === 'collapsed' ? 'panel' : 'collapsed')), []);

  const setMode = useCallback((m: ChatPanelMode) => setModeState(m), []);

  const openChatWith = useCallback((message: string) => {
    setPresetMessage(message);
    setModeState((prev) => (prev === 'collapsed' ? 'panel' : prev));
  }, []);

  const consumePreset = useCallback(() => setPresetMessage(undefined), []);

  return (
    <ChatPanelContext.Provider
      value={{ mode, isOpen, presetMessage, openChat, openChatWith, toggleChat, setMode, consumePreset }}
    >
      {children}
    </ChatPanelContext.Provider>
  );
}
