import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router';
import { Provider, useQuery } from 'urql';
import { ChatProvider } from './lib/chat-context';
import { ChatPanelProvider } from './lib/chat-panel-context';
import { graphqlClient } from './lib/graphql';
import {
  isOnboardingComplete,
  isOnboardingSkipped,
  ONBOARDING_KEYS,
  OnboardingStatusContext,
} from './lib/onboarding-context';
import { ThemeProvider } from './lib/theme';
import { AddPositionModalProvider } from './lib/add-position-modal-context';
import AddPositionModal from './components/portfolio/add-position-modal';
import AppShell from './components/layout/app-shell';
import Position from './pages/position';
import Skills from './pages/skills';
import Chat from './pages/chat';
import Profile from './pages/profile';
import Settings from './pages/settings';
import Dashboard from './pages/dashboard';
import Positions from './pages/positions';
import OnboardingPage from './pages/onboarding';
import { ONBOARDING_STATUS_QUERY } from './api/documents';
import type { OnboardingStatusQueryResult } from './api/types';

// Gate the lazy import behind the build-time env flag so Vite tree-shakes
// the entire chunk when disabled — avoids 404 in production where
// `agentation` (a devDependency) isn't installed.
const AgentationComponent =
  import.meta.env.VITE_AGENTATION_ENABLED === 'true'
    ? lazy(() => import('agentation').then((m) => ({ default: m.Agentation })))
    : null;

function DevFeedbackTool() {
  if (!AgentationComponent) return null;
  return (
    <Suspense fallback={null}>
      <AgentationComponent />
    </Suspense>
  );
}

function RedirectPositionSymbol() {
  const { symbol } = useParams<{ symbol: string }>();
  return <Navigate to={`/portfolio/${symbol}`} replace />;
}

/**
 * Guards app routes behind onboarding completion.
 * When onboarding is not complete, renders the app blurred in the background
 * with the onboarding flow in a modal overlay. The modal can be re-opened
 * from anywhere via useOnboardingModal().
 */
function OnboardingGuard() {
  // Allow ?reset query param to clear onboarding state for testing
  const [didReset] = useState(() => {
    if (new URLSearchParams(window.location.search).has('reset')) {
      localStorage.removeItem(ONBOARDING_KEYS.COMPLETE_KEY);
      localStorage.removeItem(ONBOARDING_KEYS.SKIPPED_KEY);
      localStorage.removeItem(ONBOARDING_KEYS.STEP_KEY);
      localStorage.removeItem(ONBOARDING_KEYS.STATE_KEY);
      window.history.replaceState({}, '', window.location.pathname);
      return true;
    }
    return false;
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [completed, setCompleted] = useState(() => (didReset ? false : isOnboardingComplete()));
  const [skipped, setSkipped] = useState(() => (didReset ? false : isOnboardingSkipped()));

  const [result] = useQuery<OnboardingStatusQueryResult>({
    query: ONBOARDING_STATUS_QUERY,
    pause: completed || skipped,
  });

  const openOnboarding = useCallback(() => setModalOpen(true), []);

  const markSkipped = useCallback(() => {
    localStorage.setItem(ONBOARDING_KEYS.SKIPPED_KEY, 'true');
    setSkipped(true);
    setModalOpen(false);
  }, []);

  const markCompleted = useCallback(() => {
    localStorage.setItem(ONBOARDING_KEYS.COMPLETE_KEY, 'true');
    localStorage.removeItem(ONBOARDING_KEYS.SKIPPED_KEY);
    localStorage.removeItem(ONBOARDING_KEYS.STEP_KEY);
    localStorage.removeItem(ONBOARDING_KEYS.STATE_KEY);
    setCompleted(true);
    setSkipped(false);
    setModalOpen(false);
  }, []);

  const resetOnboardingStatus = useCallback(() => {
    localStorage.removeItem(ONBOARDING_KEYS.COMPLETE_KEY);
    localStorage.removeItem(ONBOARDING_KEYS.SKIPPED_KEY);
    localStorage.removeItem(ONBOARDING_KEYS.STEP_KEY);
    localStorage.removeItem(ONBOARDING_KEYS.STATE_KEY);
    setCompleted(false);
    setSkipped(false);
  }, []);

  const serverCompleted = result.data?.onboardingStatus?.completed ?? false;

  // Re-hydrate localStorage when backend confirms completion (external side-effect only)
  useEffect(() => {
    if (!completed && !skipped && serverCompleted) {
      localStorage.setItem(ONBOARDING_KEYS.COMPLETE_KEY, 'true');
    }
  }, [completed, skipped, serverCompleted]);

  // Derive effective completion from both local and server state
  const isComplete = completed || serverCompleted;

  // Still loading backend status — wait
  if (!isComplete && !skipped && result.fetching) return null;
  const showModal = !isComplete && (!skipped || modalOpen);

  const statusValue = {
    completed: isComplete,
    skipped,
    openOnboarding,
    markSkipped,
    markCompleted,
    resetOnboardingStatus,
  };

  return (
    <OnboardingStatusContext.Provider value={statusValue}>
      {showModal ? (
        <>
          <div className="pointer-events-none select-none blur-sm" aria-hidden="true" inert>
            <AppShell />
          </div>
          <OnboardingPage />
        </>
      ) : (
        <AppShell />
      )}
    </OnboardingStatusContext.Provider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <Provider value={graphqlClient}>
        <ChatProvider>
          <ChatPanelProvider>
            <AddPositionModalProvider>
              <Routes>
                {/* Main app — guarded by onboarding check */}
                <Route element={<OnboardingGuard />}>
                  <Route index element={<Dashboard />} />
                  <Route path="portfolio" element={<Positions />} />
                  <Route path="portfolio/:symbol" element={<Position />} />
                  <Route path="chat" element={<Chat />} />
                  <Route path="skills" element={<Skills />} />
                  <Route path="profile" element={<Profile />} />
                  <Route path="settings" element={<Settings />} />

                  {/* Redirects for old paths */}
                  <Route path="positions" element={<Navigate to="/portfolio" replace />} />
                  <Route path="positions/:symbol" element={<RedirectPositionSymbol />} />
                  <Route path="alerts" element={<Navigate to="/skills" replace />} />
                </Route>
              </Routes>
              <AddPositionModal />
              {import.meta.env.VITE_AGENTATION_ENABLED === 'true' && <DevFeedbackTool />}
            </AddPositionModalProvider>
          </ChatPanelProvider>
        </ChatProvider>
      </Provider>
    </ThemeProvider>
  );
}
