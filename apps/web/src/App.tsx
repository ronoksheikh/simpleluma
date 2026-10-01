import { Spinner } from '@heroui/react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { useMe } from './lib/auth';
import { AuthPage } from './pages/AuthPage';
import { DashboardPage } from './pages/DashboardPage';
import { SettingsPage } from './pages/SettingsPage';
import { SetupModelPage } from './pages/SetupModelPage';
import { SharePage } from './pages/SharePage';
import { StudioPage } from './pages/StudioPage';

function Protected({ children }: { children: React.ReactNode }) {
  const { data: me, isLoading } = useMe();
  if (isLoading) return <div className="grid h-full place-items-center"><Spinner /></div>;
  return me ? children : <Navigate to="/login" replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/signup" element={<AuthPage mode="signup" />} />
      <Route path="/s/:token" element={<SharePage />} />
      <Route element={<Protected><AppShell /></Protected>}>
        <Route index element={<DashboardPage />} />
        <Route path="setup" element={<SetupModelPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="p/:id" element={<StudioPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
