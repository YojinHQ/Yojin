import { createContext, useCallback, useContext, useState } from 'react';

interface SignalModalContextValue {
  open: boolean;
  signalIds: string[];
  openSignals: (ids: string[]) => void;
  closeSignals: () => void;
}

const SignalModalContext = createContext<SignalModalContextValue>({
  open: false,
  signalIds: [],
  openSignals: () => {},
  closeSignals: () => {},
});

export function SignalModalProvider({ children }: { children: React.ReactNode }) {
  const [signalIds, setSignalIds] = useState<string[]>([]);

  const openSignals = useCallback((ids: string[]) => {
    if (ids.length > 0) setSignalIds(ids);
  }, []);

  const closeSignals = useCallback(() => {
    setSignalIds([]);
  }, []);

  return (
    <SignalModalContext.Provider value={{ open: signalIds.length > 0, signalIds, openSignals, closeSignals }}>
      {children}
    </SignalModalContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSignalModal() {
  return useContext(SignalModalContext);
}
