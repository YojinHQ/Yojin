import { Outlet } from 'react-router';

import ChatPanel from '../chat/chat-panel';
import { useChatPanel } from '../../lib/chat-panel-context';
import Sidebar from './sidebar';
import AppHeader from './app-header';

export default function AppShell() {
  const { mode } = useChatPanel();
  const isFull = mode === 'full';

  return (
    <div className="flex h-screen overflow-hidden bg-bg-primary">
      <Sidebar />
      {!isFull && (
        <div className="flex flex-1 flex-col overflow-hidden">
          <AppHeader />
          <main className="flex flex-1 overflow-hidden">
            <Outlet />
          </main>
        </div>
      )}
      <ChatPanel />
    </div>
  );
}
