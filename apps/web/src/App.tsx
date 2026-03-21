import { Routes, Route, Navigate, useParams } from 'react-router';
import { Provider } from 'urql';
import { ChatProvider } from './lib/chat-context';
import { ChatPanelProvider } from './lib/chat-panel-context';
import { graphqlClient } from './lib/graphql';
import { ThemeProvider } from './lib/theme';
import AppShell from './components/layout/app-shell';
import Position from './pages/position';
import Skills from './pages/skills';
import Profile from './pages/profile';
import Settings from './pages/settings';
import Dashboard from './pages/dashboard';
import Positions from './pages/positions';
import Signals from './pages/signals';

function RedirectPositionSymbol() {
  const { symbol } = useParams<{ symbol: string }>();
  return <Navigate to={`/portfolio/${symbol}`} replace />;
}

export default function App() {
  return (
    <ThemeProvider>
      <Provider value={graphqlClient}>
        <ChatProvider>
          <ChatPanelProvider>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<Dashboard />} />
                <Route path="portfolio" element={<Positions />} />
                <Route path="portfolio/:symbol" element={<Position />} />
                <Route path="chat" element={<Navigate to="/" replace />} />
                <Route path="signals" element={<Signals />} />
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
