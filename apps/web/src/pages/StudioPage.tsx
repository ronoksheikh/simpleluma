import { Chip, Dropdown, Spinner, Tabs } from '@heroui/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { BrainIcon, ChevronIcon, CodeIcon, DotsIcon, FilmIcon, FolderIcon, HistoryIcon, ListIcon, MicIcon, PaletteIcon, PlayIcon, TerminalIcon, TrashIcon } from '../components/icons';
import { AssetsTab } from '../components/studio/AssetsTab';
import { AudioTab } from '../components/studio/AudioTab';
import { BrandTab } from '../components/studio/BrandTab';
import { ChatPanel } from '../components/studio/ChatPanel';
import { CodeTab } from '../components/studio/CodeTab';
import { HistoryTab } from '../components/studio/HistoryTab';
import { MemoryTab } from '../components/studio/MemoryTab';
import { PlanTab } from '../components/studio/PlanTab';
import { PreviewPanel } from '../components/studio/PreviewPanel';
import { RendersTab } from '../components/studio/RendersTab';
import { ShareDialog, type ShareTarget } from '../components/studio/ShareDialog';
import { TerminalTab } from '../components/studio/TerminalTab';
import { RunHeader } from '../components/studio/RunHeader';
import { api } from '../lib/api';
import { notify } from '../lib/notify';
import { useProjectEvents } from '../lib/realtime';
import { StudioProvider, useStudio, type WorkspaceTab } from '../lib/studio';
import type { ProjectDetail, RenderView } from '../lib/types';

function EditableTitle({ project }: { project: ProjectDetail }) {
  const client = useQueryClient();
  const [value, setValue] = useState(project.name);
  const save = async () => {
    const name = value.trim();
    if (!name || name === project.name) return setValue(project.name);
    await api.patch(`/api/projects/${project.id}`, { name });
    await client.invalidateQueries({ queryKey: ['project', project.id] });
    await client.invalidateQueries({ queryKey: ['projects'] });
  };
  return (
    <input
      value={value}
      aria-label="Video name"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void save()}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className="min-w-0 max-w-[280px] truncate rounded-lg bg-transparent px-1.5 py-0.5 text-[15px] font-semibold outline-none hover:bg-ink/[0.04] focus:bg-white focus:ring-2 focus:ring-lumablue/30"
      style={{ width: `${Math.max(6, value.length + 1)}ch` }}
    />
  );
}

function RunChip() {
  const { chat } = useStudio();
  const run = chat.run;
  if (chat.running) return <Chip size="sm" color="accent" variant="soft"><span className="pulse-dot mr-1 size-1.5 rounded-full bg-lumablue" /><Chip.Label>Working</Chip.Label></Chip>;
  if (!run) return <Chip size="sm" variant="soft"><Chip.Label>New</Chip.Label></Chip>;
  const map = {
    done: { label: 'Ready', color: 'success' as const },
    paused: { label: 'Paused', color: 'accent' as const },
    interrupted: { label: 'Interrupted', color: 'accent' as const },
    stopped: { label: 'Stopped', color: 'default' as const },
    failed: { label: 'Failed', color: 'danger' as const },
    running: { label: 'Working', color: 'accent' as const },
  }[run.status];
  return <Chip size="sm" color={map.color} variant="soft"><Chip.Label>{map.label}</Chip.Label></Chip>;
}

const MAIN_TABS: Array<{ id: WorkspaceTab; label: string; icon: React.ReactNode }> = [
  { id: 'preview', label: 'Preview', icon: <PlayIcon size={13} /> },
  { id: 'plan', label: 'Plan', icon: <ListIcon size={14} /> },
  { id: 'brand', label: 'Brand', icon: <PaletteIcon size={14} /> },
  { id: 'assets', label: 'Assets', icon: <FolderIcon size={14} /> },
  { id: 'renders', label: 'Renders', icon: <FilmIcon size={14} /> },
  { id: 'terminal', label: 'Terminal', icon: <TerminalIcon size={14} /> },
];
const MORE_TABS: Array<{ id: WorkspaceTab; label: string; icon: React.ReactNode }> = [
  { id: 'history', label: 'History', icon: <HistoryIcon size={14} /> },
  { id: 'memory', label: 'Memory', icon: <BrainIcon size={14} /> },
  { id: 'audio', label: 'Audio', icon: <MicIcon size={14} /> },
  { id: 'code', label: 'Code', icon: <CodeIcon size={14} /> },
];

function Workspace({ project, reloadKey, onShare }: { project: ProjectDetail; reloadKey: number; onShare: (s: ShareTarget) => void }) {
  const { tab, setTab, chat } = useStudio();
  const { data: renders = [] } = useQuery({ queryKey: ['renders', project.id], queryFn: () => api.get<RenderView[]>(`/api/projects/${project.id}/renders`) });
  const active = renders.filter((r) => r.status === 'rendering' || r.status === 'queued').length;
  const done = chat.todos.filter((t) => t.status === 'done').length;
  const badge = (id: WorkspaceTab) =>
    id === 'plan' && chat.todos.length ? <span className="ml-1 text-[11px] tabular-nums text-ink/40">{done}/{chat.todos.length}</span>
    : id === 'assets' && project.attachments.length ? <span className="ml-1 text-[11px] text-ink/40">{project.attachments.length}</span>
    : id === 'renders' && active ? <Spinner size="sm" className="ml-1" />
    : null;
  const inMore = MORE_TABS.find((t) => t.id === tab);

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Workspace">
      <div className="flex shrink-0 items-center gap-1 border-b border-ink/[0.06] px-2">
        <Tabs variant="secondary" selectedKey={inMore ? '__more' : tab} onSelectionChange={(k) => setTab(String(k) as WorkspaceTab)} className="min-w-0 flex-1">
          <Tabs.ListContainer className="thin-scroll overflow-x-auto py-1.5">
            <Tabs.List aria-label="Workspace" className="bg-transparent">
              {MAIN_TABS.map((t) => (
                <Tabs.Tab key={t.id} id={t.id} className="h-8 whitespace-nowrap px-2.5 text-[12.5px]">
                  <span className="flex items-center gap-1.5">{t.icon}{t.label}{badge(t.id)}</span>
                  <Tabs.Indicator />
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>
        <Dropdown>
          <Dropdown.Trigger className={`flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[13px] ${inMore ? 'bg-lumablue/10 text-royal' : 'text-ink/60 hover:bg-ink/5'}`}>
            {inMore ? <>{inMore.icon}{inMore.label}</> : 'More'}<ChevronIcon size={13} className="rotate-90" />
          </Dropdown.Trigger>
          <Dropdown.Popover placement="bottom end">
            <Dropdown.Menu onAction={(k) => setTab(String(k) as WorkspaceTab)}>
              {MORE_TABS.map((t) => <Dropdown.Item key={t.id} id={t.id} textValue={t.label}><span className="flex items-center gap-2">{t.icon}{t.label}</span></Dropdown.Item>)}
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      </div>
      <div className="relative min-h-0 flex-1">
        {/* Preview and terminal stay mounted so the player keeps its place and shells stay connected. */}
        <div className={tab === 'preview' ? 'h-full' : 'hidden'}>
          <PreviewPanel video={project.video} reloadKey={reloadKey} head={project.head} onShare={() => onShare({ kind: 'version', title: `${project.name} (live preview)` })} />
        </div>
        <div className={tab === 'terminal' ? 'h-full' : 'hidden'}><TerminalTab projectId={project.id} visible={tab === 'terminal'} /></div>
        {tab === 'plan' && <PlanTab />}
        {tab === 'brand' && <BrandTab projectId={project.id} attachments={project.attachments} />}
        {tab === 'assets' && <AssetsTab attachments={project.attachments} />}
        {tab === 'renders' && <div className="thin-scroll h-full overflow-y-auto p-4"><RendersTab projectId={project.id} onShare={(renderId, label) => onShare({ kind: 'render', target: renderId, title: `${project.name} · ${label}` })} /></div>}
        {tab === 'history' && <div className="thin-scroll h-full overflow-y-auto p-4"><HistoryTab projectId={project.id} onShare={(sha, message) => onShare({ kind: 'version', target: sha, title: `${project.name} · ${message}` })} /></div>}
        {tab === 'memory' && <MemoryTab projectId={project.id} />}
        {tab === 'audio' && <div className="thin-scroll h-full overflow-y-auto p-4"><AudioTab projectId={project.id} /></div>}
        {tab === 'code' && <CodeTab projectId={project.id} />}
      </div>
    </section>
  );
}

function readSplit(): number {
  try {
    const v = Number(localStorage.getItem('luma.split'));
    if (v >= 0.3 && v <= 0.75) return v;
  } catch {
    // ignore
  }
  return 0.52;
}

function Studio({ project }: { project: ProjectDetail }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { chat } = useStudio();
  const [reloadKey, setReloadKey] = useState(0);
  const [share, setShare] = useState<ShareTarget | null>(null);
  const [split, setSplit] = useState(readSplit);
  const [mobileView, setMobileView] = useState<'chat' | 'workspace'>('chat');
  const [confirm, setConfirm] = useState<'clear' | 'delete' | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const id = project.id;

  useProjectEvents(id, (e) => {
    if (e.type === 'files.changed') {
      setReloadKey((k) => k + 1);
      void client.invalidateQueries({ queryKey: ['files', id] });
      void client.invalidateQueries({ queryKey: ['file', id] });
      void client.invalidateQueries({ queryKey: ['project', id] });
    } else if (e.type === 'history.changed') {
      void client.invalidateQueries({ queryKey: ['history', id] });
      void client.invalidateQueries({ queryKey: ['project', id] });
    } else if (e.type === 'render.progress') {
      const incoming = e.render as RenderView;
      client.setQueryData<RenderView[]>(['renders', id], (old = []) => (old.some((r) => r.id === incoming.id) ? old.map((r) => (r.id === incoming.id ? incoming : r)) : [incoming, ...old]));
      if (incoming.status === 'done') notify.success(`${incoming.kind === 'final' ? 'Final render' : 'Preview render'} done`);
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('luma.split', String(split));
    } catch {
      // ignore
    }
  }, [split]);

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const rect = box.current!.getBoundingClientRect();
    const move = (ev: PointerEvent) => setSplit(Math.min(0.75, Math.max(0.3, 1 - (ev.clientX - rect.left) / rect.width)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const clearChat = async () => {
    try {
      await api.del(`/api/projects/${id}/chat`);
      window.location.reload();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : 'Could not clear the chat.');
    }
  };
  const deleteVideo = async () => {
    await api.del(`/api/projects/${id}`);
    await client.invalidateQueries({ queryKey: ['projects'] });
    navigate('/');
  };

  return (
    <div ref={box} className="panel flex h-full min-h-0 overflow-hidden">
      <div className={`min-w-0 flex-col border-ink/[0.06] lg:flex lg:border-r ${mobileView === 'chat' ? 'flex' : 'hidden'}`} style={{ flex: `1 1 ${(1 - split) * 100}%` }}>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-ink/[0.06] px-3">
          <EditableTitle key={project.name} project={project} />
          <RunChip />
          <span className="flex-1" />
          <div className="flex rounded-lg bg-ink/[0.04] p-0.5 lg:hidden">
            {(['chat', 'workspace'] as const).map((v) => (
              <button key={v} type="button" onClick={() => setMobileView(v)} className={`rounded-md px-2.5 py-1 text-[12px] capitalize ${mobileView === v ? 'bg-white shadow-sm' : 'text-ink/55'}`}>{v}</button>
            ))}
          </div>
          <Dropdown>
            <Dropdown.Trigger aria-label="Video actions" className="grid size-8 place-items-center rounded-lg text-ink/50 hover:bg-ink/5"><DotsIcon size={17} /></Dropdown.Trigger>
            <Dropdown.Popover placement="bottom end">
              <Dropdown.Menu onAction={(k) => setConfirm(k as 'clear' | 'delete')}>
                <Dropdown.Item id="clear" textValue="Clear chat" isDisabled={chat.running}>Clear chat</Dropdown.Item>
                <Dropdown.Item id="delete" textValue="Delete video" variant="danger"><span className="flex items-center gap-2"><TrashIcon size={14} />Delete video</span></Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </header>
        <RunHeader />
        <div className="min-h-0 flex-1"><ChatPanel /></div>
      </div>
      <div onPointerDown={startDrag} className="group relative hidden w-0 cursor-col-resize lg:block" role="separator" aria-orientation="vertical" aria-label="Resize panels">
        <span className="absolute inset-y-0 -left-1.5 w-3 transition-colors group-hover:bg-lumablue/10" />
      </div>
      <div className={`min-w-0 flex-col lg:flex ${mobileView === 'workspace' ? 'flex' : 'hidden'}`} style={{ flex: `1 1 ${split * 100}%` }}>
        <Workspace project={project} reloadKey={reloadKey} onShare={setShare} />
      </div>
      <ShareDialog projectId={id} share={share} onClose={() => setShare(null)} />
      <ConfirmDialog
        isOpen={confirm !== null}
        title={confirm === 'delete' ? 'Delete this video?' : 'Clear the chat?'}
        message={confirm === 'delete' ? `“${project.name}”, its history and its renders will be removed for good.` : 'The conversation is removed. Files, history, plan and memory stay.'}
        confirmLabel={confirm === 'delete' ? 'Delete video' : 'Clear chat'}
        onConfirm={() => void (confirm === 'delete' ? deleteVideo() : clearChat())}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}

export function StudioPage() {
  const { id = '' } = useParams();
  const { data: project, error } = useQuery({ queryKey: ['project', id], queryFn: () => api.get<ProjectDetail>(`/api/projects/${id}`) });

  if (error) {
    return (
      <div className="grid h-full place-items-center text-center">
        <div>
          <p className="text-lg font-semibold">We could not open this video.</p>
          <p className="mt-1 text-ink/60">{error.message}</p>
          <Link to="/" className="mt-4 inline-block font-medium text-lumablue">Back home</Link>
        </div>
      </div>
    );
  }
  if (!project) return <div className="grid h-full place-items-center"><Spinner /></div>;

  return (
    <StudioProvider key={id} projectId={id}>
      <Studio project={project} />
    </StudioProvider>
  );
}

