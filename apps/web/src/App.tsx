import { Routes, Route, Navigate, useParams } from 'react-router';
import { Provider } from 'urql';
import { graphqlClient } from './lib/graphql';
import { ThemeProvider } from './lib/theme';
import AppShell from './components/layout/app-shell';
import Dashboard from './pages/dashboard';
import Positions from './pages/positions';
import AppShell from './components/layout/app-shell';
import Dashboard from './pages/Dashboard';
import Positions from './pages/Positions';
import Position from './pages/Position';
import Skills from './pages/Alerts';
import Chat from './pages/chat';
import Profile from './pages/profile';
import Settings from './pages/Settings';
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
