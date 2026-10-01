import { Avatar, Button, Dropdown, SearchField } from '@heroui/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useMe } from '../lib/auth';
import { clock, tokens } from '../lib/format';
import type { ProjectSummary } from '../lib/types';
import { BrainIcon, GearIcon, HomeIcon, LogoutIcon, PlusIcon, SidebarIcon } from './icons';
import { Logo, LogoSymbol } from './Logo';

interface ShellValue {
  collapsed: boolean;
  toggle(): void;
}

const ShellContext = createContext<ShellValue>({ collapsed: false, toggle: () => undefined });
export const useShell = (): ShellValue => useContext(ShellContext);

function readCollapsed(): boolean {
  try {
    const saved = localStorage.getItem('luma.sidebar');
    if (saved) return saved === 'collapsed';
  } catch {
    // storage blocked: fall back to the screen size
  }
  return window.innerWidth < 1100;
}

export function useProjects() {
  return useQuery({ queryKey: ['projects'], queryFn: () => api.get<ProjectSummary[]>('/api/projects'), refetchInterval: 20_000 });
}

function StatusDot({ project }: { project: ProjectSummary }) {
  if (project.running) return <span className="pulse-dot size-2 shrink-0 rounded-full bg-lumablue" aria-label="Director working" />;
  if (project.lastRun?.status === 'paused') return <span className="size-2 shrink-0 rounded-full bg-sky" aria-label="Waiting to continue" />;
  if (project.lastRun?.status === 'failed') return <span className="size-2 shrink-0 rounded-full bg-danger" aria-label="Last run failed" />;
  return null;
}

function ProjectLink({ project, active }: { project: ProjectSummary; active: boolean }) {
  const v = project.video;
  return (
    <Link
      to={`/p/${project.id}`}
      className={`group flex flex-col gap-0.5 rounded-xl px-3 py-2 transition-colors ${active ? 'bg-white shadow-[0_1px_2px_rgb(22_24_29/0.06),0_0_0_1px_rgb(22_24_29/0.06)]' : 'hover:bg-ink/[0.04]'}`}
    >
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{project.name}</span>
        <StatusDot project={project} />
      </span>
      <span className="truncate text-[11.5px] text-ink/45">
        {v ? `${v.width}×${v.height} · ${v.fps} fps · ${clock(v.duration)}` : 'No video yet'}
        {project.usage.prompt + project.usage.completion > 0 ? ` · ${tokens(project.usage.prompt + project.usage.completion)} tok` : ''}
      </span>
    </Link>
  );
}

function Sidebar() {
  const { data: me } = useMe();
  const { data: projects = [] } = useProjects();
  const { id } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { collapsed, toggle } = useShell();
  const [query, setQuery] = useState('');

  const logout = async () => {
    await api.post('/api/auth/logout');
    client.clear();
    navigate('/login');
  };

  const shown = projects.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));
  const running = projects.filter((p) => p.running).length;

  if (collapsed) {
    return (
      <aside className="flex w-[60px] shrink-0 flex-col items-center gap-2 py-3" aria-label="Sidebar">
        <button title="Expand sidebar" type="button" onClick={toggle} aria-label="Expand sidebar" className="grid size-10 place-items-center rounded-xl hover:bg-ink/5"><LogoSymbol size={26} /></button>
        <Button isIconOnly size="sm" aria-label="New video" onPress={() => navigate('/?new=1')}><PlusIcon size={16} /></Button>
        <NavLink to="/" end aria-label="Home" className={({ isActive }) => `grid size-9 place-items-center rounded-xl ${isActive ? 'bg-white text-lumablue shadow-sm' : 'text-ink/55 hover:bg-ink/5'}`}><HomeIcon size={18} /></NavLink>
        <NavLink to="/settings" aria-label="Settings" className={({ isActive }) => `grid size-9 place-items-center rounded-xl ${isActive ? 'bg-white text-lumablue shadow-sm' : 'text-ink/55 hover:bg-ink/5'}`}><GearIcon size={18} /></NavLink>
        <div className="mt-auto">
          <Avatar size="sm" color="accent"><Avatar.Fallback>{me?.email.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase()}</Avatar.Fallback></Avatar>
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex w-[264px] shrink-0 flex-col" aria-label="Sidebar">
      <div className="flex h-14 items-center justify-between px-4">
        <Logo />
        <button title="Collapse sidebar" type="button" onClick={toggle} aria-label="Collapse sidebar" className="grid size-8 place-items-center rounded-lg text-ink/45 hover:bg-ink/5 hover:text-ink"><SidebarIcon size={17} /></button>
      </div>

      <div className="px-3">
        <button
          type="button"
          onClick={() => navigate('/?new=1')}
          className="flex w-full items-center gap-2 rounded-xl bg-lumablue/[0.08] px-3 py-2 text-[14px] font-medium text-lumablue transition-colors hover:bg-lumablue/[0.14]"
        >
          <PlusIcon size={16} />New video
        </button>
      </div>

      <nav className="mt-3 flex flex-col gap-0.5 px-3" aria-label="Main">
        <NavLink to="/" end className={({ isActive }) => `flex items-center gap-2.5 rounded-xl px-3 py-1.5 text-[13.5px] ${isActive ? 'bg-white font-medium shadow-[0_0_0_1px_rgb(22_24_29/0.06)]' : 'text-ink/70 hover:bg-ink/[0.04]'}`}><HomeIcon size={16} />Home</NavLink>
        <NavLink to="/settings?tab=director" className={({ isActive }) => `flex items-center gap-2.5 rounded-xl px-3 py-1.5 text-[13.5px] ${isActive ? 'bg-white font-medium shadow-[0_0_0_1px_rgb(22_24_29/0.06)]' : 'text-ink/70 hover:bg-ink/[0.04]'}`}><BrainIcon size={16} />Director</NavLink>
      </nav>

      <div className="mt-4 flex items-center justify-between px-6">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink/40">Videos</span>
        {running > 0 && <span className="text-[11px] font-medium text-lumablue">{running} working</span>}
      </div>
      {projects.length > 6 && (
        <div className="px-3 pt-2">
          <SearchField aria-label="Search videos" value={query} onChange={setQuery} fullWidth>
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Search videos" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
        </div>
      )}
      <div className="thin-scroll mt-1.5 min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <ul className="flex flex-col gap-0.5">
          {shown.map((p) => <li key={p.id}><ProjectLink project={p} active={p.id === id} /></li>)}
        </ul>
        {projects.length === 0 && <p className="px-3 py-2 text-[13px] text-ink/45">Your videos appear here.</p>}
      </div>

      <div className="border-t border-ink/[0.07] p-3">
        <Dropdown>
          <Dropdown.Trigger className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-ink/[0.04]">
            <Avatar size="sm" color="accent"><Avatar.Fallback>{me?.email.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase()}</Avatar.Fallback></Avatar>
            <span className="min-w-0 flex-1 truncate text-[13px]">{me?.email}</span>
            <GearIcon size={15} className="text-ink/40" />
          </Dropdown.Trigger>
          <Dropdown.Popover placement="top start">
            <Dropdown.Menu onAction={(key) => (key === 'logout' ? void logout() : navigate(`/settings?tab=${String(key)}`))}>
              <Dropdown.Item id="director" textValue="Director"><span className="flex items-center gap-2"><BrainIcon size={15} />Director</span></Dropdown.Item>
              <Dropdown.Item id="models" textValue="Models"><span className="flex items-center gap-2"><GearIcon size={15} />Models &amp; keys</span></Dropdown.Item>
              <Dropdown.Item id="usage" textValue="Usage"><span className="flex items-center gap-2"><GearIcon size={15} />Usage</span></Dropdown.Item>
              <Dropdown.Item id="logout" textValue="Log out" variant="danger"><span className="flex items-center gap-2"><LogoutIcon size={15} />Log out</span></Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      </div>
    </aside>
  );
}

export function AppShell() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const location = useLocation();
  useEffect(() => {
    try {
      localStorage.setItem('luma.sidebar', collapsed ? 'collapsed' : 'open');
    } catch {
      // ignore
    }
  }, [collapsed]);
  const studio = location.pathname.startsWith('/p/');

  return (
    <ShellContext.Provider value={{ collapsed, toggle: () => setCollapsed((c) => !c) }}>
      <div className="flex h-full min-h-0 bg-canvas">
        <Sidebar />
        <main className={`min-w-0 flex-1 ${studio ? 'h-full overflow-hidden py-2 pr-2' : 'thin-scroll h-full overflow-y-auto'}`}>
          <Outlet />
        </main>
      </div>
    </ShellContext.Provider>
  );
}
