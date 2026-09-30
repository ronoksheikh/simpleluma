import { Button, Spinner, Tabs } from '@heroui/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LogoMark } from '../components/Logo';
import { ChevronIcon, GearIcon } from '../components/icons';
import { AudioTab } from '../components/studio/AudioTab';
import { ChatPanel } from '../components/studio/ChatPanel';
import { FilesTab } from '../components/studio/FilesTab';
import { HistoryTab } from '../components/studio/HistoryTab';
import { PreviewPanel } from '../components/studio/PreviewPanel';
import { RendersTab } from '../components/studio/RendersTab';
import { ShareDialog, type ShareTarget } from '../components/studio/ShareDialog';
import { TerminalDock, type DockTab } from '../components/studio/TerminalDock';
import { api } from '../lib/api';
import { notify } from '../lib/notify';
import { useProjectEvents } from '../lib/realtime';
import type { ProjectDetail, RenderView } from '../lib/types';

type Tab = 'preview' | 'renders' | 'history' | 'audio' | 'files';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'preview', label: 'Preview' },
  { id: 'renders', label: 'Renders' },
  { id: 'history', label: 'History' },
  { id: 'audio', label: 'Audio' },
  { id: 'files', label: 'Files' },
];

function EditableTitle({ project }: { project: ProjectDetail }) {
  const client = useQueryClient();
  const [value, setValue] = useState(project.name);
  const save = async () => {
    const name = value.trim();
    if (!name || name === project.name) return setValue(project.name);
    await api.patch(`/api/projects/${project.id}`, { name });
    await client.invalidateQueries({ queryKey: ['project', project.id] });
  };
  return (
    <input
      value={value}
      aria-label="Video name"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void save()}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className="wordmark w-full min-w-0 max-w-sm rounded-lg bg-transparent px-2 py-1 text-lg outline-none hover:bg-white focus:bg-white focus:ring-2 focus:ring-lumablue/40"
    />
  );
}

export function StudioPage() {
  const { id = '' } = useParams();
  const client = useQueryClient();
  const [tab, setTab] = useState<Tab>('preview');
  const [reloadKey, setReloadKey] = useState(0);
  const [dockOpen, setDockOpen] = useState(false);
  const [dockTab, setDockTab] = useState<DockTab>('user');
  const [share, setShare] = useState<ShareTarget | null>(null);
  const [starting, setStarting] = useState<'preview' | 'final' | null>(null);

  const { data: project, error } = useQuery({ queryKey: ['project', id], queryFn: () => api.get<ProjectDetail>(`/api/projects/${id}`) });
  const { data: renders = [] } = useQuery({ queryKey: ['renders', id], queryFn: () => api.get<RenderView[]>(`/api/projects/${id}/renders`) });
  const rendering = renders.some((r) => r.status === 'rendering' || r.status === 'queued');

  useProjectEvents(id, (e) => {
    if (e.type === 'files.changed') {
      setReloadKey((k) => k + 1);
      void client.invalidateQueries({ queryKey: ['files', id] });
      void client.invalidateQueries({ queryKey: ['project', id] });
    } else if (e.type === 'history.changed') {
      void client.invalidateQueries({ queryKey: ['history', id] });
      void client.invalidateQueries({ queryKey: ['project', id] });
    } else if (e.type === 'render.progress') {
      const incoming = e.render as RenderView;
      client.setQueryData<RenderView[]>(['renders', id], (old = []) => (old.some((r) => r.id === incoming.id) ? old.map((r) => (r.id === incoming.id ? incoming : r)) : [incoming, ...old]));
    } else if (e.type === 'run.end') {
      void client.invalidateQueries({ queryKey: ['renders', id] });
    }
  });

  const startRender = async (kind: 'preview' | 'final') => {
    setStarting(kind);
    try {
      await api.post(`/api/projects/${id}/renders`, { kind });
      setTab('renders');
    } catch (e) {
      notify.error(e instanceof Error ? e.message : 'Could not start the render.');
    } finally {
      setStarting(null);
    }
  };

  if (error) {
    return (
      <div className="grid h-full place-items-center text-center">
        <div>
          <p className="text-lg font-semibold">We could not open this video.</p>
          <p className="mt-1 text-night/60">{error.message}</p>
          <Link to="/" className="mt-4 inline-block font-medium text-lumablue">Back to your videos</Link>
        </div>
      </div>
    );
  }
  if (!project) return <div className="grid h-full place-items-center"><Spinner /></div>;

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <header className="flex shrink-0 items-center gap-3 px-1">
        <Link to="/" aria-label="Back to your videos" className="flex items-center gap-2 text-night/60 hover:text-night"><LogoMark size={28} /><ChevronIcon size={14} className="rotate-180" /></Link>
        <EditableTitle key={project.name} project={project} />
        <Link to="/settings" className="ml-auto text-night/50 hover:text-night" aria-label="Settings"><GearIcon size={18} /></Link>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(340px,430px)_minmax(0,1fr)]">
        <ChatPanel projectId={id} attachments={project.attachments} />

        <section className="flex min-h-0 flex-col gap-3" aria-label="Video">
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(String(k) as Tab)}>
              <Tabs.ListContainer>
                <Tabs.List aria-label="Video sections">
                  {TABS.map((t) => <Tabs.Tab key={t.id} id={t.id}>{t.label}<Tabs.Indicator /></Tabs.Tab>)}
                </Tabs.List>
              </Tabs.ListContainer>
            </Tabs>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="secondary" isPending={starting === 'preview'} isDisabled={rendering} onPress={() => void startRender('preview')}>Quick preview</Button>
              <Button size="sm" isPending={starting === 'final'} isDisabled={rendering} onPress={() => void startRender('final')}>Final 1080p</Button>
            </div>
          </div>
          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
            {tab === 'preview' && <PreviewPanel projectId={id} video={project.video} reloadKey={reloadKey} head={project.head} onShare={() => setShare({ kind: 'version', title: `${project.name} (live preview)` })} />}
            {tab === 'renders' && <RendersTab projectId={id} onShare={(renderId, label) => setShare({ kind: 'render', target: renderId, title: `${project.name} · ${label}` })} />}
            {tab === 'history' && <HistoryTab projectId={id} onShare={(sha, message) => setShare({ kind: 'version', target: sha, title: `${project.name} · ${message}` })} />}
            {tab === 'audio' && <AudioTab projectId={id} />}
            {tab === 'files' && <FilesTab projectId={id} attachments={project.attachments} />}
          </div>
        </section>
      </div>

      <TerminalDock projectId={id} open={dockOpen} tab={dockTab} onOpen={setDockOpen} onTab={setDockTab} />
      <ShareDialog projectId={id} share={share} onClose={() => setShare(null)} />
    </div>
  );
}
