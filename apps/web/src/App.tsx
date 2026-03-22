import { Routes, Route, Navigate, useParams, useLocation } from 'react-router';
import { Provider, useQuery } from 'urql';
import { ChatProvider } from './lib/chat-context';
import { ChatPanelProvider } from './lib/chat-panel-context';
import { graphqlClient } from './lib/graphql';
import { isOnboardingComplete, isOnboardingSkipped, ONBOARDING_KEYS } from './lib/onboarding-context';
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
 * When localStorage is cleared, queries the backend to check if onboarding
 * was already completed server-side and re-hydrates the flag.
 */
function OnboardingGuard() {
  const location = useLocation();
  const localDone = isOnboardingComplete() || isOnboardingSkipped();

  const [result] = useQuery<OnboardingStatusQueryResult>({
    query: ONBOARDING_STATUS_QUERY,
    pause: localDone,
  });

  if (localDone) return <AppShell />;

  // Query still in flight — wait before deciding
  if (result.fetching) return null;

  // Backend confirms onboarding was completed — re-hydrate localStorage and show app
  if (result.data?.onboardingStatus?.completed) {
    localStorage.setItem(ONBOARDING_KEYS.COMPLETE_KEY, 'true');
    return <AppShell />;
  }

  // Neither local nor server says done — redirect to onboarding
  if (location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }
  return <AppShell />;
}

function OnboardingRedirectIfComplete() {
  if (isOnboardingComplete()) {
    return <Navigate to="/" replace />;
  }
  return <OnboardingPage />;
}

export default function App() {
  return (
    <ThemeProvider>
      <Provider value={graphqlClient}>
        <ChatProvider>
          <ChatPanelProvider>
            <Routes>
              {/* Onboarding — outside AppShell */}
              <Route path="onboarding" element={<OnboardingRedirectIfComplete />} />

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
