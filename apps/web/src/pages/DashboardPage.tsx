import { Alert, Button, Chip, Dropdown, Skeleton, buttonVariants } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useProjects } from '../components/AppShell';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ArrowUpIcon, BoltIcon, BrainIcon, FilmIcon, LayersIcon, PlayIcon, TrashIcon } from '../components/icons';
import { LogoMark } from '../components/Logo';
import { api } from '../lib/api';
import { useMe } from '../lib/auth';
import { clock, greeting, timeAgo, tokens } from '../lib/format';
import { notify } from '../lib/notify';
import type { ProjectSummary } from '../lib/types';

const TEMPLATES = [
  { id: 'blank', title: 'Blank', text: 'Start from nothing', icon: <LayersIcon size={15} /> },
  { id: 'three', title: '3D · Three.js', text: 'A lit 3D scene with GSAP', icon: <BoltIcon size={15} /> },
  { id: 'kinetic', title: 'Kinetic type', text: 'GSAP typography, 1:1', icon: <FilmIcon size={15} /> },
  { id: 'demo', title: 'Demo reel', text: '24 s reel with music', icon: <PlayIcon size={13} /> },
] as const;

const FORMATS = [
  { id: 'landscape', label: '16:9', hint: '1920×1080' },
  { id: 'square', label: '1:1', hint: '1080×1080' },
  { id: 'vertical', label: '9:16', hint: '1080×1920' },
] as const;

const IDEAS = [
  'A 6-second logo intro: the mark unfolds petal by petal, then the wordmark settles',
  'A 15-second product teaser in 3D with a slow orbit and three feature callouts',
  'Kinetic typography for “Learn by making” on beat at 120 bpm, vertical for reels',
  'An animated bar chart of our growth with a calm voice-over',
];

function Composer() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState('');
  const [template, setTemplate] = useState<(typeof TEMPLATES)[number]['id']>('blank');
  const [format, setFormat] = useState<(typeof FORMATS)[number]['id']>('landscape');
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (params.get('new')) {
      input.current?.focus();
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const create = useMutation({
    mutationFn: (brief: string) => {
      const f = FORMATS.find((x) => x.id === format)!;
      const prompt = brief.trim() ? `${brief.trim()}${format !== 'landscape' ? `\n\nFormat: ${f.label} (${f.hint}).` : ''}` : undefined;
      return api.post<{ id: string }>('/api/projects', { template, prompt, name: prompt ? undefined : 'Untitled video' });
    },
    onSuccess: async ({ id }) => {
      await client.invalidateQueries({ queryKey: ['projects'] });
      navigate(`/p/${id}`);
    },
    onError: (e) => notify.error(e.message),
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (text.trim()) create.mutate(text);
    }
  };

  return (
    <>
    <div className="rounded-3xl border border-ink/[0.08] bg-white p-2 shadow-[0_24px_60px_-30px_rgb(41_112_236/0.45)]">
      <textarea
        ref={input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        rows={3}
        aria-label="Describe your video"
        placeholder="Describe the video. Brand, length, mood, music, voice-over…"
        className="block w-full resize-none bg-transparent px-4 pt-3 text-[16px] leading-relaxed outline-none placeholder:text-ink/35"
      />
      <div className="flex flex-wrap items-center gap-1.5 px-2 pb-1 pt-2">
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTemplate(t.id)}
            title={t.text}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors ${template === t.id ? 'border-lumablue/40 bg-lumablue/[0.08] text-royal' : 'border-ink/10 text-ink/60 hover:border-ink/25'}`}
          >
            {t.icon}{t.title}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-ink/10" />
        <div className="flex rounded-full bg-ink/[0.04] p-0.5" role="radiogroup" aria-label="Format">
          {FORMATS.map((f) => (
            <button key={f.id} type="button" role="radio" aria-checked={format === f.id} title={f.hint} onClick={() => setFormat(f.id)} className={`rounded-full px-2.5 py-0.5 text-[12px] ${format === f.id ? 'bg-white font-medium shadow-sm' : 'text-ink/55'}`}>
              {f.label}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <Button size="sm" isIconOnly aria-label="Start" className="rounded-full" isPending={create.isPending && !!text.trim()} isDisabled={!text.trim()} onPress={() => create.mutate(text)}>
          <ArrowUpIcon size={17} />
        </Button>
      </div>
    </div>
    <div className="mt-3 flex flex-wrap justify-center gap-1.5">
      {IDEAS.map((idea) => (
        <button key={idea} type="button" onClick={() => { setText(idea); input.current?.focus(); }} className="max-w-full truncate rounded-full bg-white/70 px-3 py-1 text-[12px] text-ink/55 ring-1 ring-ink/[0.06] transition-colors hover:bg-white hover:text-ink" title={idea}>{idea}</button>
      ))}
      <button type="button" onClick={() => create.mutate('')} className="rounded-full px-3 py-1 text-[12px] font-medium text-lumablue hover:bg-lumablue/[0.08]">or open an empty video →</button>
    </div>
    </>
  );
}

function ProjectCard({ project, onDelete }: { project: ProjectSummary; onDelete: () => void }) {
  const [broken, setBroken] = useState(false);
  const v = project.video;
  const status = project.running ? { label: 'Working', color: 'accent' as const } : project.lastRun?.status === 'paused' ? { label: 'Paused', color: 'accent' as const } : project.lastRun?.status === 'failed' ? { label: 'Failed', color: 'danger' as const } : null;
  return (
    <div className="group relative">
      <Link to={`/p/${project.id}`} className="block overflow-hidden rounded-2xl border border-ink/[0.07] bg-white transition-all hover:-translate-y-0.5 hover:shadow-[0_16px_40px_-20px_rgb(22_24_29/0.3)]">
        <div className="relative aspect-video overflow-hidden bg-stage">
          {broken ? (
            <div className="grid h-full place-items-center bg-ink/[0.03]"><LogoMark size={40} className="opacity-80" /></div>
          ) : (
            <img src={`/api/projects/${project.id}/thumbnail?v=${project.updatedAt}`} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" onError={() => setBroken(true)} />
          )}
          {status && (
            <span className="absolute left-2.5 top-2.5">
              <Chip size="sm" color={status.color} variant="primary">{project.running && <span className="pulse-dot mr-1 size-1.5 rounded-full bg-white" />}<Chip.Label>{status.label}</Chip.Label></Chip>
            </span>
          )}
        </div>
        <div className="px-3.5 py-3">
          <div className="truncate text-[14px] font-medium">{project.name}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink/50">
            <span>{timeAgo(project.updatedAt)}</span>
            {v && <span>· {v.width}×{v.height} · {clock(v.duration)}</span>}
            {project.usage.prompt + project.usage.completion > 0 && <span className="ml-auto tabular-nums">{tokens(project.usage.prompt + project.usage.completion)} tok</span>}
          </div>
        </div>
      </Link>
      <Dropdown>
        <Dropdown.Trigger aria-label={`More actions for ${project.name}`} className={`${buttonVariants({ isIconOnly: true, size: 'sm', variant: 'secondary' })} absolute right-2.5 top-2.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100`}>
          <span aria-hidden className="text-lg leading-none">⋯</span>
        </Dropdown.Trigger>
        <Dropdown.Popover>
          <Dropdown.Menu onAction={(key) => key === 'delete' && onDelete()}>
            <Dropdown.Item id="delete" textValue="Delete video" variant="danger"><span className="flex items-center gap-2"><TrashIcon size={15} />Delete video</span></Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-ink/[0.07] bg-white px-4 py-3">
      <span className="grid size-9 place-items-center rounded-xl bg-lumablue/[0.08] text-lumablue">{icon}</span>
      <div>
        <div className="text-[18px] font-semibold tabular-nums leading-tight">{value}</div>
        <div className="text-[12px] text-ink/50">{label}</div>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const client = useQueryClient();
  const { data: me } = useMe();
  const { data: projects, isLoading } = useProjects();
  const { data: usage } = useQuery({ queryKey: ['usage'], queryFn: () => api.get<{ total: { prompt: number; completion: number; runs: number; steps: number } }>('/api/usage') });
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/projects/${id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: ['projects'] }),
    onError: (e) => notify.error(e.message),
  });
  const name = me?.email.split('@')[0] ?? '';
  const working = projects?.filter((p) => p.running).length ?? 0;

  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(60%_80%_at_50%_0%,rgb(93_174_255/0.18),transparent_70%)]" />
      <div className="relative mx-auto max-w-5xl px-6 pb-16 pt-14">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[14px] text-ink/50">{greeting()}{name ? `, ${name}` : ''}</p>
          <h1 className="wordmark mt-2 text-[40px] leading-[1.1]">What should we <span className="brand-text">direct</span> today?</h1>
          <p className="mt-3 text-[15px] text-ink/55">Brief the Director. It plans, builds in code with Canvas, Three.js and GSAP, checks every frame and renders the MP4.</p>
        </div>

        <div className="mx-auto mt-8 max-w-2xl">
          {me && !me.hasModel && (
            <Alert className="mb-4" status="accent">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Connect a model first</Alert.Title>
                <Alert.Description>The Director runs on any OpenAI-compatible model with tool calling. <Link className="font-medium text-lumablue" to="/setup">Connect one</Link>.</Alert.Description>
              </Alert.Content>
            </Alert>
          )}
          <Composer />
        </div>

        <div className="mt-12 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Videos" value={String(projects?.length ?? 0)} icon={<FilmIcon size={17} />} />
          <Stat label="Working now" value={String(working)} icon={<PlayIcon size={14} />} />
          <Stat label="Director runs" value={String(usage?.total.runs ?? 0)} icon={<BrainIcon size={17} />} />
          <Stat label="Tokens used" value={tokens((usage?.total.prompt ?? 0) + (usage?.total.completion ?? 0))} icon={<BoltIcon size={17} />} />
        </div>

        <div className="mt-10 flex items-end justify-between">
          <h2 className="text-[17px] font-semibold">Recent videos</h2>
          {projects && projects.length > 0 && <span className="text-[12.5px] text-ink/45">{projects.length} total</span>}
        </div>
        {isLoading ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="aspect-[4/3] rounded-2xl" />)}</div>
        ) : projects && projects.length > 0 ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => <ProjectCard key={p.id} project={p} onDelete={() => setDeleting(p)} />)}
          </div>
        ) : (
          <div className="mt-4 flex flex-col items-center rounded-2xl border border-dashed border-ink/15 px-6 py-12 text-center">
            <LogoMark size={44} />
            <p className="mt-4 font-medium">No videos yet</p>
            <p className="mt-1 max-w-sm text-[13.5px] text-ink/55">Write a brief above, or pick the 3D or Kinetic template to see Three.js and GSAP in action.</p>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={deleting !== null}
        title="Delete this video?"
        message={`“${deleting?.name ?? ''}”, its history and its renders will be removed for good.`}
        confirmLabel="Delete video"
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
