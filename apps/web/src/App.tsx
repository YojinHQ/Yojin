import { Routes, Route, Navigate, useParams } from 'react-router';
import { Provider } from 'urql';
import { graphqlClient } from './lib/graphql';
import { ThemeProvider } from './lib/theme';
import AppShell from './components/layout/app-shell';
import Position from './pages/position';
import Skills from './pages/skills';
import Chat from './pages/chat';
import Profile from './pages/profile';
import Settings from './pages/settings';
import Dashboard from './pages/dashboard';
import Positions from './pages/positions';

function RedirectPositionSymbol() {
  const { symbol } = useParams<{ symbol: string }>();
  return <Navigate to={`/portfolio/${symbol}`} replace />;
}

export default function App() {
  return (
    <ThemeProvider>
      <Provider value={graphqlClient}>
        <Routes>
          <Route element={<AppShell />}>
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
      </Provider>
    </ThemeProvider>
  );
}
