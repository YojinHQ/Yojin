import { Outlet } from 'react-router';
import Sidebar from './sidebar';

export default function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden bg-bg-primary">
      <Sidebar />
      <main className="flex flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
