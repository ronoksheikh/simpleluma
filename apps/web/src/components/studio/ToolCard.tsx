import { ProgressBar, Spinner } from '@heroui/react';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { CheckIcon, ChevronIcon, XIcon } from '../icons';
import { api } from '../../lib/api';
import type { ChatMessage, RenderView, ToolCall } from '../../lib/types';
import { DiffView } from './DiffView';

interface Args {
  path?: string;
  message?: string;
  time?: number;
  command?: string;
  name?: string;
}

const short = (s: string, n = 48): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** "Editing scenes/intro.js" while running, "Edited scenes/intro.js" when done. */
function labels(name: string, a: Args): [running: string, done: string] {
  const file = a.path ?? 'file';
  switch (name) {
    case 'list_files': return ['Listing files', 'Listed files'];
    case 'read_file': return [`Reading ${file}`, `Read ${file}`];
    case 'write_file': return [`Writing ${file}`, `Wrote ${file}`];
    case 'edit_file': return [`Editing ${file}`, `Edited ${file}`];
    case 'delete_file': return [`Deleting ${file}`, `Deleted ${file}`];
    case 'commit': return ['Saving a version', `Saved: ${short(a.message ?? 'version')}`];
    case 'render_preview': return ['Rendering quick preview…', 'Rendered quick preview'];
    case 'render_final': return ['Rendering final 1080p…', 'Rendered final 1080p'];
    case 'capture_frame': return [`Checking the frame at ${a.time ?? 0}s`, `Checked the frame at ${a.time ?? 0}s`];
    case 'run_command': return [`Running ${short(a.command ?? 'command', 40)}`, `Ran ${short(a.command ?? 'command', 40)}`];
    case 'list_voices': return ['Finding voices', 'Found voices'];
    case 'generate_voice': return [`Generating voice “${a.name ?? ''}”`, `Generated voice “${a.name ?? ''}”`];
    case 'share_preview': return ['Creating a share link', 'Created a share link'];
    default: return [name, name];
  }
}

function parseArgs(raw: string): Args {
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
}

export function ToolCard({ call, result, progress, projectId }: Props) {
  const [open, setOpen] = useState(false);
  const args = parseArgs(call.function.arguments);
  const [running, done] = labels(call.function.name, args);
  const meta = { ...progress, ...result?.meta } as Record<string, unknown>;
  const renderId = typeof meta.renderId === 'string' ? meta.renderId : null;
  const { data: renders } = useQuery({ queryKey: ['renders', projectId], queryFn: () => api.get<RenderView[]>(`/api/projects/${projectId}/renders`), enabled: renderId !== null });
  const render = renders?.find((r) => r.id === renderId);

  const status = !result ? 'running' : result.failed ? 'failed' : 'ok';
  const diff = typeof meta.diff === 'string' ? meta.diff : null;
  const image = typeof meta.imageUrl === 'string' ? meta.imageUrl : null;
  const shareUrl = typeof meta.shareUrl === 'string' ? meta.shareUrl : null;
  const showsOutput = call.function.name === 'run_command' || status === 'failed' || shareUrl !== null;
  const hasDetail = diff !== null || image !== null || (showsOutput && !!result?.content);

  let detail: ReactNode = null;
  if (open) {
    detail = (
      <div className="mt-2 flex flex-col gap-2">
        {diff && <DiffView patch={diff} />}
        {image && <img src={image} alt={`Frame at ${String(meta.time ?? '')}s`} className="w-full rounded-xl border border-night/10" />}
        {showsOutput && result?.content && (
          <pre className="thin-scroll max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-night p-3 font-mono text-xs text-offwhite">{result.content}</pre>
        )}
      </div>
    );
  }

  const badge =
    typeof meta.added === 'number' ? <span className="font-mono text-xs text-night/50">+{String(meta.added)} −{String(meta.removed)}</span> : null;

  return (
    <div className="rounded-2xl border border-night/10 bg-white px-3 py-2 text-sm">
      <button type="button" disabled={!hasDetail} onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2.5 text-left disabled:cursor-default">
        <span className="grid size-5 shrink-0 place-items-center">
          {status === 'running' ? <Spinner size="sm" /> : status === 'ok' ? <CheckIcon size={16} className="text-lumablue" /> : <XIcon size={16} className="text-danger" />}
        </span>
        <span className={`min-w-0 flex-1 truncate ${status === 'failed' ? 'text-danger' : ''}`}>{status === 'running' ? running : done}</span>
        {badge}
        {hasDetail && <ChevronIcon size={15} className={`shrink-0 text-night/40 transition-transform ${open ? 'rotate-90' : ''}`} />}
      </button>
      {render && render.status === 'rendering' && (
        <div className="mt-2">
          <ProgressBar value={Math.round(render.progress * 100)} aria-label="Render progress">
            <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
          </ProgressBar>
          <p className="mt-1 text-xs text-night/55">{render.framesDone} of {render.framesTotal} frames · {Math.round(render.progress * 100)}%{render.etaSeconds !== null ? ` · ${render.etaSeconds}s left` : ''}</p>
        </div>
      )}
      {shareUrl && <a className="mt-1 block truncate text-xs text-lumablue hover:text-royal" href={shareUrl} target="_blank" rel="noreferrer">{shareUrl}</a>}
      {detail}
    </div>
  );
}
