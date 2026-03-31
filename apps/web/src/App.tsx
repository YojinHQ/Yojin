import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useSearchParams } from 'react-router';
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
import { AssetDetailModalProvider } from './lib/asset-detail-modal-context';
import { SignalModalProvider } from './lib/signal-modal-context';
import AddPositionModal from './components/portfolio/add-position-modal';
import AssetDetailModal from './components/portfolio/asset-detail-modal';
import { SignalsModal } from './components/common/signals-modal';
import AppShell from './components/layout/app-shell';
import Chat from './pages/chat';
import Profile from './pages/profile';
import Settings from './pages/settings';
import Dashboard from './pages/dashboard';
import Insights from './pages/insights';
import Positions from './pages/positions';
import Watchlist from './pages/watchlist';
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
  return <Navigate to="/portfolio" replace />;
}

function SignalsRedirect() {
  const [searchParams] = useSearchParams();
  const params = new URLSearchParams();
  params.set('tab', 'all');
  const ticker = searchParams.get('ticker');
  const highlight = searchParams.get('highlight');
  const search = searchParams.get('search');
  if (ticker) params.set('ticker', ticker);
  if (highlight) params.set('highlight', highlight);
  if (search) params.set('search', search);
  return <Navigate to={`/insights?${params.toString()}`} replace />;
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
      localStorage.removeItem(ONBOARDING_KEYS.PERSONA_NAME_KEY);
      window.history.replaceState({}, '', window.location.pathname);
      return true;
    }
    return false;
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [completed, setCompleted] = useState(() => (didReset ? false : isOnboardingComplete()));
  const [skipped, setSkipped] = useState(() => (didReset ? false : isOnboardingSkipped()));
  // Track whether a reset has been requested. Stays true until markCompleted clears it.
  // The effective `resetting` flag is derived below (no effect needed to clear it).
  const [resetRequested, setResetRequested] = useState(didReset);

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
    // Persist the persona name before clearing onboarding state
    try {
      const raw = localStorage.getItem(ONBOARDING_KEYS.STATE_KEY);
      if (raw) {
        const name = (JSON.parse(raw) as { persona?: { name?: string } })?.persona?.name;
        if (name) localStorage.setItem(ONBOARDING_KEYS.PERSONA_NAME_KEY, name);
      }
    } catch {
      /* best-effort */
    }

    localStorage.setItem(ONBOARDING_KEYS.COMPLETE_KEY, 'true');
    localStorage.removeItem(ONBOARDING_KEYS.SKIPPED_KEY);
    localStorage.removeItem(ONBOARDING_KEYS.STEP_KEY);
    localStorage.removeItem(ONBOARDING_KEYS.STATE_KEY);
    setCompleted(true);
    setSkipped(false);
    setResetRequested(false);
    setModalOpen(false);
  }, []);

  const resetOnboardingStatus = useCallback(() => {
    localStorage.removeItem(ONBOARDING_KEYS.COMPLETE_KEY);
    localStorage.removeItem(ONBOARDING_KEYS.SKIPPED_KEY);
    localStorage.removeItem(ONBOARDING_KEYS.STEP_KEY);
    localStorage.removeItem(ONBOARDING_KEYS.STATE_KEY);
    localStorage.removeItem(ONBOARDING_KEYS.PERSONA_NAME_KEY);
    setCompleted(false);
    setSkipped(false);
    setResetRequested(true);
  }, []);

  const serverCompleted = result.data?.onboardingStatus?.completed ?? false;

  // Derive effective resetting state: true while the server still reports the old
  // (completed) state or is mid-fetch after a reset request. Auto-clears once the
  // query resolves with completed=false — no cascading setState in an effect needed.
  const resetting = resetRequested && (serverCompleted || result.fetching);

  // Re-hydrate localStorage when backend confirms completion (external side-effect only).
  // Skip during reset — stale cache would re-assert completion before the invalidated
  // query resolves with the fresh (completed: false) response.
  useEffect(() => {
    if (!resetting && !completed && !skipped && serverCompleted) {
      localStorage.setItem(ONBOARDING_KEYS.COMPLETE_KEY, 'true');
    }
  }, [resetting, completed, skipped, serverCompleted]);

  // Derive effective completion from both local and server state.
  // During a reset, ignore stale serverCompleted from cache.
  const isComplete = completed || (!resetting && serverCompleted);

  // Still loading backend status — wait
  if (!isComplete && !skipped && result.fetching) return null;
  const showModal = !isComplete && (!skipped || modalOpen);

  const statusValue = {
    completed: isComplete,
    skipped,
    isReset: resetRequested,
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
              <AssetDetailModalProvider>
                <SignalModalProvider>
                  <Routes>
                    {/* Main app — guarded by onboarding check */}
                    <Route element={<OnboardingGuard />}>
                      <Route index element={<Dashboard />} />
                      <Route path="portfolio" element={<Positions />} />
                      <Route path="chat" element={<Chat />} />
                      <Route path="insights" element={<Insights />} />
                      <Route path="signals" element={<SignalsRedirect />} />
                      <Route path="watchlist" element={<Watchlist />} />
                      <Route path="profile" element={<Profile />} />
                      <Route path="settings" element={<Settings />} />

                      {/* Redirects for old paths */}
                      <Route path="positions" element={<Navigate to="/portfolio" replace />} />
                      <Route path="positions/:symbol" element={<RedirectPositionSymbol />} />
                      <Route path="portfolio/:symbol" element={<Navigate to="/portfolio" replace />} />
                      <Route path="skills" element={<Navigate to="/" replace />} />
                      <Route path="alerts" element={<Navigate to="/" replace />} />
                    </Route>
                  </Routes>
                  <AddPositionModal />
                  <AssetDetailModal />
                  <SignalsModal />
                  {import.meta.env.VITE_AGENTATION_ENABLED === 'true' && <DevFeedbackTool />}
                </SignalModalProvider>
              </AssetDetailModalProvider>
            </AddPositionModalProvider>
          </ChatPanelProvider>
        </ChatProvider>
      </Provider>
    </ThemeProvider>
  );
}
