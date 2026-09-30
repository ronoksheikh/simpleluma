import { Button } from '@heroui/react';
import { useQueryClient } from '@tanstack/react-query';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useMe } from '../lib/auth';
import { GearIcon } from './icons';
import { Logo } from './Logo';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${isActive ? 'bg-white text-night shadow-sm' : 'text-night/60 hover:text-night'}`;

export function AppShell() {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const client = useQueryClient();

  const logout = async () => {
    await api.post('/api/auth/logout');
    client.clear();
    navigate('/login');
  };

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between px-6">
        <Logo />
        <nav className="flex items-center gap-1">
          <NavLink to="/" end className={navClass}>Videos</NavLink>
          <NavLink to="/settings" className={navClass}>
            <span className="flex items-center gap-1.5"><GearIcon size={15} />Settings</span>
          </NavLink>
        </nav>
        <div className="flex items-center gap-3 text-sm text-night/60">
          <span className="hidden sm:inline">{me?.email}</span>
          <Button size="sm" variant="ghost" onPress={logout}>Log out</Button>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
