import { Outlet } from 'react-router';
import Sidebar from './sidebar';
import Header from './header';

export default function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden bg-bg-primary">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
