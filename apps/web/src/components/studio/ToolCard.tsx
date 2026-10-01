import { ProgressBar, Spinner } from '@heroui/react';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { api } from '../../lib/api';
import type { ChatMessage, RenderView, ToolCall } from '../../lib/types';
import {
  BoltIcon, BrainIcon, CheckIcon, ChevronIcon, CodeIcon, CrosshairIcon, EditIcon, EyeIcon, FileIcon, FilmIcon, FlagIcon, FolderIcon,
  GlobeIcon, ListIcon, MicIcon, PaletteIcon, SearchIcon, ShareIcon, TerminalIcon, TrashIcon, XIcon,
} from '../icons';
import { DiffView } from './DiffView';

interface Args {
  path?: string;
  message?: string;
  time?: number;
  command?: string;
  name?: string;
  content?: string;
  summary?: string;
  scope?: string;
  items?: Array<{ text: string; status: string }>;
  times?: number[];
  pattern?: string;
  url?: string;
  save_as?: string;
}

const short = (s: string, n = 48): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** "Editing scenes/intro.js" while running, "Edited scenes/intro.js" when done, and an icon. */
export function toolLabels(name: string, a: Args): { running: string; done: string; icon: ReactNode } {
  const file = a.path ?? 'file';
  const i = (n: ReactNode) => n;
  switch (name) {
    case 'list_files': return { running: 'Listing files', done: 'Listed files', icon: i(<FolderIcon size={15} />) };
    case 'read_file': return { running: `Reading ${file}`, done: `Read ${file}`, icon: i(<FileIcon size={15} />) };
    case 'write_file': return { running: `Writing ${file}`, done: `Wrote ${file}`, icon: i(<CodeIcon size={15} />) };
    case 'edit_file': return { running: `Editing ${file}`, done: `Edited ${file}`, icon: i(<EditIcon size={15} />) };
    case 'delete_file': return { running: `Deleting ${file}`, done: `Deleted ${file}`, icon: i(<TrashIcon size={15} />) };
    case 'commit': return { running: 'Saving a version', done: `Saved: ${short(a.message ?? 'version')}`, icon: i(<CheckIcon size={15} />) };
    case 'checkpoint': return { running: 'Saving a checkpoint', done: 'Checkpoint saved', icon: i(<FlagIcon size={15} />) };
    case 'update_plan': return { running: 'Updating the plan', done: 'Updated the plan', icon: i(<ListIcon size={15} />) };
    case 'check_video': return { running: 'Checking the whole video', done: 'Checked the video', icon: i(<BoltIcon size={15} />) };
    case 'render_preview': return { running: 'Rendering quick preview…', done: 'Rendered quick preview', icon: i(<FilmIcon size={15} />) };
    case 'render_final': return { running: 'Rendering final 1080p…', done: 'Rendered final 1080p', icon: i(<FilmIcon size={15} />) };
    case 'capture_frame': return { running: `Looking at ${a.time ?? 0}s`, done: `Looked at ${a.time ?? 0}s`, icon: i(<CrosshairIcon size={15} />) };
    case 'view_reference': return { running: `Studying ${file}`, done: `Studied ${file}`, icon: i(<EyeIcon size={15} />) };
    case 'run_command': return { running: `Running ${short(a.command ?? 'command', 40)}`, done: `Ran ${short(a.command ?? 'command', 40)}`, icon: i(<TerminalIcon size={15} />) };
    case 'remember': return { running: 'Saving to memory', done: `Remembered${a.scope === 'global' ? ' (all videos)' : ''}`, icon: i(<BrainIcon size={15} />) };
    case 'forget': return { running: 'Forgetting a note', done: 'Forgot a note', icon: i(<BrainIcon size={15} />) };
    case 'update_brand': return { running: 'Recording the brand', done: 'Updated brand.json', icon: i(<PaletteIcon size={15} />) };
    case 'search_files': return { running: `Searching for “${short(a.pattern ?? '', 30)}”`, done: `Searched for “${short(a.pattern ?? '', 30)}”`, icon: i(<SearchIcon size={15} />) };
    case 'fetch_url': return { running: `Fetching ${short((a.url ?? '').replace(/^https?:\/\//, ''), 40)}`, done: a.save_as ? `Downloaded ${a.save_as}` : `Read ${short((a.url ?? '').replace(/^https?:\/\//, ''), 40)}`, icon: i(<GlobeIcon size={15} />) };
    case 'list_voices': return { running: 'Finding voices', done: 'Found voices', icon: i(<MicIcon size={15} />) };
    case 'generate_voice': return { running: `Recording “${a.name ?? ''}”`, done: `Recorded “${a.name ?? ''}”`, icon: i(<MicIcon size={15} />) };
    case 'share_preview': return { running: 'Creating a share link', done: 'Created a share link', icon: i(<ShareIcon size={15} />) };
    default: return { running: name, done: name, icon: i(<BoltIcon size={15} />) };
  }
}

export function parseArgs(raw: string): Args {
  try {
    return JSON.parse(raw) as Args;
  } catch {
    return {};
  }
}

interface Props {
  call: ToolCall;
  result?: ChatMessage;
  progress?: Record<string, unknown>;
  projectId: string;
  /** When the tool started (the previous step's end), to show how long it took. */
  startedAt?: number;
}

export function ToolCard({ call, result, progress, projectId, startedAt }: Props) {
  const [open, setOpen] = useState(false);
  const args = parseArgs(call.function.arguments);
  const { running, done, icon } = toolLabels(call.function.name, args);
  const meta = { ...progress, ...result?.meta } as Record<string, unknown>;
  const renderId = typeof meta.renderId === 'string' ? meta.renderId : null;
  const { data: renders } = useQuery({ queryKey: ['renders', projectId], queryFn: () => api.get<RenderView[]>(`/api/projects/${projectId}/renders`), enabled: renderId !== null });
  const render = renders?.find((r) => r.id === renderId);

  const status = !result ? 'running' : result.failed ? 'failed' : 'ok';
  const diff = typeof meta.diff === 'string' ? meta.diff : null;
  const image = typeof meta.imageUrl === 'string' ? meta.imageUrl : null;
  const shareUrl = typeof meta.shareUrl === 'string' ? meta.shareUrl : null;
  const showsOutput = ['run_command', 'check_video', 'update_plan', 'remember', 'checkpoint', 'view_reference', 'update_brand', 'search_files', 'fetch_url'].includes(call.function.name) || status === 'failed' || shareUrl !== null;
  const hasDetail = diff !== null || image !== null || (showsOutput && !!result?.content);
  const elapsed = result && startedAt ? Math.max(0, (result.createdAt - startedAt) / 1000) : null;

  const badge = typeof meta.added === 'number'
    ? <span className="font-mono text-[11px] tabular-nums"><span className="text-success">+{String(meta.added)}</span> <span className="text-danger/80">−{String(meta.removed)}</span></span>
    : call.function.name === 'update_plan' && typeof meta.total === 'number' ? <span className="text-[11px] text-ink/45">{String(meta.done)}/{String(meta.total)}</span> : null;

  return (
    <div className={`rounded-xl border bg-white text-[13px] transition-colors ${status === 'failed' ? 'border-danger/25' : 'border-ink/[0.07]'} ${open ? 'shadow-[0_4px_16px_-8px_rgb(22_24_29/0.15)]' : ''}`}>
      <button type="button" disabled={!hasDetail} onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left disabled:cursor-default" aria-expanded={hasDetail ? open : undefined}>
        <span className={`grid size-6 shrink-0 place-items-center rounded-lg ${status === 'failed' ? 'bg-danger/10 text-danger' : 'bg-ink/[0.04] text-ink/55'}`}>{icon}</span>
        <span className={`min-w-0 flex-1 truncate ${status === 'running' ? 'shimmer-text' : status === 'failed' ? 'text-danger' : 'text-ink/80'}`}>{status === 'running' ? running : done}</span>
        {badge}
        {elapsed !== null && elapsed > 0.05 && <span className="text-[11px] tabular-nums text-ink/35">{elapsed.toFixed(1)}s</span>}
        <span className="grid size-4 shrink-0 place-items-center">
          {status === 'running' ? <Spinner size="sm" /> : status === 'ok' ? <CheckIcon size={14} className="text-success" /> : <XIcon size={14} className="text-danger" />}
        </span>
        {hasDetail && <ChevronIcon size={14} className={`shrink-0 text-ink/35 transition-transform ${open ? 'rotate-90' : ''}`} />}
      </button>
      {render && (render.status === 'rendering' || render.status === 'queued') && (
        <div className="px-3 pb-2.5">
          <ProgressBar value={Math.round(render.progress * 100)} aria-label="Render progress" size="sm">
            <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
          </ProgressBar>
          <p className="mt-1 text-[11.5px] text-ink/50">{render.framesDone} of {render.framesTotal} frames · {Math.round(render.progress * 100)}%{render.etaSeconds !== null ? ` · ${render.etaSeconds}s left` : ''}</p>
        </div>
      )}
      {shareUrl && <a className="block truncate px-3 pb-2 text-xs text-lumablue hover:text-royal" href={shareUrl} target="_blank" rel="noreferrer">{shareUrl}</a>}
      {open && (
        <div className="flex flex-col gap-2 border-t border-ink/[0.06] p-2.5">
          {diff && <DiffView patch={diff} />}
          {image && <img src={image} alt={`Frame at ${String(meta.time ?? '')}s`} className="w-full rounded-lg border border-ink/10" />}
          {showsOutput && result?.content && (
            <pre className="thin-scroll max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-[#15171c] p-3 font-mono text-[11.5px] leading-relaxed text-[#e8ecf3]">{result.content}</pre>
          )}
        </div>
      )}
    </div>
  );
}
