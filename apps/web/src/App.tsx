import { useState, useCallback, useEffect } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router';
import { Provider, useQuery } from 'urql';
import { ChatProvider } from './lib/chat-context';
import { ChatPanelProvider } from './lib/chat-panel-context';
import { graphqlClient } from './lib/graphql';
import {
  isOnboardingComplete,
  isOnboardingSkipped,
  ONBOARDING_KEYS,
  OnboardingModalContext,
} from './lib/onboarding-context';
import { ThemeProvider } from './lib/theme';
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
  const [modalOpen, setModalOpen] = useState(false);

  const completed = isOnboardingComplete();
  const skipped = isOnboardingSkipped();

  const [result] = useQuery<OnboardingStatusQueryResult>({
    query: ONBOARDING_STATUS_QUERY,
    pause: completed || skipped,
  });

  const openOnboarding = useCallback(() => setModalOpen(true), []);
  const closeOnboarding = useCallback(() => setModalOpen(false), []);

  const serverCompleted = result.data?.onboardingStatus?.completed ?? false;

  // Re-hydrate localStorage when backend confirms completion (in an effect, not render)
  useEffect(() => {
    if (!completed && !skipped && serverCompleted) {
      localStorage.setItem(ONBOARDING_KEYS.COMPLETE_KEY, 'true');
    }
  }, [completed, skipped, serverCompleted]);

  // Still loading backend status — wait
  if (!completed && !skipped && result.fetching) return null;
  const isComplete = completed || serverCompleted;
  const showModal = !isComplete && (!skipped || modalOpen);

  return (
    <OnboardingModalContext.Provider value={{ openOnboarding }}>
      {showModal ? (
        <>
          <div className="pointer-events-none select-none blur-sm" aria-hidden="true" inert>
            <AppShell />
          </div>
          <OnboardingPage onDismiss={closeOnboarding} />
        </>
      ) : (
        <AppShell />
      )}
    </OnboardingModalContext.Provider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <Provider value={graphqlClient}>
        <ChatProvider>
          <ChatPanelProvider>
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
          </ChatPanelProvider>
        </ChatProvider>
      </Provider>
    </ThemeProvider>
  );
}
