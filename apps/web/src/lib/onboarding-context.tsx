import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';

export interface AiProviderState {
  method: 'magic-link' | 'api-key' | 'env-detected';
  model?: string;
  validated: boolean;
}

export interface PersonaState {
  name: string;
  riskTolerance: 'conservative' | 'moderate' | 'aggressive';
  assetClasses: string[];
  communicationStyle: 'concise' | 'detailed' | 'technical';
  hardRules?: string;
  previewMarkdown?: string;
  confirmed: boolean;
}

export interface ConnectedPlatform {
  platform: string;
  positionCount: number;
}

export interface PlatformsState {
  connected: ConnectedPlatform[];
  skipped: boolean;
}

export interface BriefingState {
  time: string;
  timezone: string;
  sections: string[];
  channel: 'web';
}

export interface OnboardingState {
  aiProvider?: AiProviderState;
  persona?: PersonaState;
  platforms?: PlatformsState;
  briefing?: BriefingState;
}

interface OnboardingContextValue {
  state: OnboardingState;
  currentStep: number;
  isReset: boolean;
  updateState: (patch: Partial<OnboardingState>) => void;
  goToStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  skipOnboarding: () => void;
  completeOnboarding: () => void;
}

const STEP_KEY = 'onboarding_step';
const STATE_KEY = 'onboarding_state';
const COMPLETE_KEY = 'onboarding_complete';
const SKIPPED_KEY = 'onboarding_skipped';

export const ONBOARDING_KEYS = { STEP_KEY, STATE_KEY, COMPLETE_KEY, SKIPPED_KEY } as const;

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

function readStep(): number {
  const raw = localStorage.getItem(STEP_KEY);
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isNaN(n) ? 0 : Math.min(Math.max(n, 0), 5);
}

function readState(): OnboardingState {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function isOnboardingComplete(): boolean {
  return localStorage.getItem(COMPLETE_KEY) === 'true';
}

export function isOnboardingSkipped(): boolean {
  return localStorage.getItem(SKIPPED_KEY) === 'true' && !isOnboardingComplete();
}

export function OnboardingProvider({
  children,
  initialStep,
  isReset = false,
  onDismiss,
}: {
  children: ReactNode;
  initialStep?: number;
  isReset?: boolean;
  onDismiss?: () => void;
}) {
  const [currentStep, setCurrentStep] = useState(() => initialStep ?? readStep());
  const [state, setState] = useState<OnboardingState>(readState);

  // Persist step changes
  useEffect(() => {
    localStorage.setItem(STEP_KEY, String(currentStep));
  }, [currentStep]);

  // Persist state changes
  useEffect(() => {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  }, [state]);

  const updateState = useCallback((patch: Partial<OnboardingState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const goToStep = useCallback((step: number) => {
    setCurrentStep(Math.min(Math.max(step, 0), 5));
  }, []);

  const nextStep = useCallback(() => {
    setCurrentStep((prev) => Math.min(prev + 1, 5));
  }, []);

  const prevStep = useCallback(() => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  }, []);

  const skipOnboarding = useCallback(() => {
    localStorage.setItem(SKIPPED_KEY, 'true');
    onDismiss?.();
  }, [onDismiss]);

  const completeOnboarding = useCallback(() => {
    localStorage.setItem(COMPLETE_KEY, 'true');
    localStorage.removeItem(SKIPPED_KEY);
    localStorage.removeItem(STEP_KEY);
    localStorage.removeItem(STATE_KEY);
    onDismiss?.();
  }, [onDismiss]);

  return (
    <OnboardingContext.Provider
      value={{
        state,
        currentStep,
        isReset,
        updateState,
        goToStep,
        nextStep,
        prevStep,
        skipOnboarding,
        completeOnboarding,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error('useOnboarding must be used within OnboardingProvider');
  return ctx;
}

/**
 * Context for opening the onboarding modal from anywhere in the app
 * (e.g., setup banner, sidebar CTA). Provided by OnboardingGuard.
 */
const OnboardingModalContext = createContext<{ openOnboarding: () => void }>({
  openOnboarding: () => {},
});

export { OnboardingModalContext };

export function useOnboardingModal() {
  return useContext(OnboardingModalContext);
}
