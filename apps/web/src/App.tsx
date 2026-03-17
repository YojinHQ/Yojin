import { Routes, Route } from 'react-router';
import { Provider } from 'urql';
import { graphqlClient } from './lib/graphql';
import AppShell from './components/layout/AppShell';
import Dashboard from './pages/Dashboard';
import Positions from './pages/Positions';
import Position from './pages/Position';
import Risk from './pages/Risk';
import Agents from './pages/Agents';
import Alerts from './pages/Alerts';
import Settings from './pages/Settings';

export default function App() {
  return (
    <Provider value={graphqlClient}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="positions" element={<Positions />} />
          <Route path="positions/:symbol" element={<Position />} />
          <Route path="risk" element={<Risk />} />
          <Route path="agents" element={<Agents />} />
          <Route path="alerts" element={<Alerts />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </Provider>
  );
}
