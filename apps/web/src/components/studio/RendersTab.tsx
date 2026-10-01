import { Button, Chip, ProgressBar, buttonVariants } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { megabytes, timeAgo } from '../../lib/format';
import { notify } from '../../lib/notify';
import type { RenderView } from '../../lib/types';
import { DownloadIcon, ShareIcon, TrashIcon } from '../icons';

function RenderCard({ render, projectId, onShare }: { render: RenderView; projectId: string; onShare: () => void }) {
  const client = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api.del(`/api/projects/${projectId}/renders/${render.id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: ['renders', projectId] }),
    onError: (e) => notify.error(e.message),
  });
  const url = `/api/projects/${projectId}/renders/${render.id}/file`;
  const label = render.kind === 'final' ? 'Final 1080p' : 'Quick preview 480p';
  const percent = Math.round(render.progress * 100);

  return (
    <li className="overflow-hidden rounded-3xl bg-white shadow-[0_2px_12px_-4px_rgb(22_24_29/0.1)]">
      {render.status === 'done' && render.kind === 'final' && (
        <div className="brand-gradient px-5 py-2 text-sm font-medium text-white">Render complete</div>
      )}
      <div className="flex items-center gap-3 px-5 pt-4">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{label}</div>
          <div className="text-sm text-ink/55">
            {timeAgo(render.createdAt)} · version <span className="font-mono">{render.commit.slice(0, 7)}</span>
            {render.status === 'done' && render.sizeBytes ? ` · ${megabytes(render.sizeBytes)}` : ''}
          </div>
        </div>
        {render.status === 'failed' && <Chip color="danger" variant="soft"><Chip.Label>Failed</Chip.Label></Chip>}
        {render.status === 'queued' && <Chip variant="soft"><Chip.Label>Queued</Chip.Label></Chip>}
      </div>

      {render.status === 'rendering' && (
        <div className="px-5 pb-4 pt-3">
          <ProgressBar value={percent} aria-label={`${label} progress`}>
            <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
          </ProgressBar>
          <div className="mt-2 flex justify-between text-sm text-ink/60">
            <span>{render.framesDone.toLocaleString()} of {render.framesTotal.toLocaleString()} frames · {percent}%</span>
            <span>{render.etaSeconds !== null ? `${render.etaSeconds}s left` : 'Starting…'}</span>
          </div>
          {render.chunksCached > 0 && <p className="mt-1 text-xs text-ink/50">{render.chunksCached} of {render.chunksTotal} scenes reused from cache</p>}
        </div>
      )}

      {render.status === 'failed' && <pre className="thin-scroll mx-5 my-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-danger/10 p-3 font-mono text-xs text-danger">{render.error}</pre>}

      {render.status === 'done' && (
        <div className="px-5 pt-3">
          <video src={url} controls preload="metadata" className="aspect-video w-full rounded-2xl bg-stage" />
          {render.chunksTotal > 0 && (
            <p className="mt-2 text-xs text-ink/50">
              {render.chunksTotal - render.chunksCached} of {render.chunksTotal} scenes rendered, {render.chunksCached} reused from cache
            </p>
          )}
        </div>
      )}

      <div className="flex gap-2 px-5 py-4">
        {render.status === 'done' && (
          <>
            <a href={`${url}?download=1`} download className={buttonVariants({ size: 'sm', variant: 'secondary' })}>
              <DownloadIcon size={15} />Download
            </a>
            <Button size="sm" variant="secondary" onPress={onShare}><ShareIcon size={15} />Share</Button>
          </>
        )}
        {(render.status === 'done' || render.status === 'failed') && (
          <Button size="sm" variant="ghost" isIconOnly aria-label="Delete render" onPress={() => remove.mutate()}><TrashIcon size={15} /></Button>
        )}
      </div>
    </li>
  );
}

export function RendersTab({ projectId, onShare }: { projectId: string; onShare: (renderId: string, label: string) => void }) {
  const { data: renders = [], isLoading } = useQuery({ queryKey: ['renders', projectId], queryFn: () => api.get<RenderView[]>(`/api/projects/${projectId}/renders`) });
  if (!isLoading && renders.length === 0) {
    return (
      <div className="grid h-full place-items-center px-6 text-center text-ink/60">
        <div>
          <p className="font-medium text-ink">No renders yet</p>
          <p className="mt-1 text-sm">Use “Quick preview” for a fast 480p check, or “Final” for 1080p. Only scenes that changed are re-rendered.</p>
        </div>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-4">
      {renders.map((r) => (
        <RenderCard key={r.id} render={r} projectId={projectId} onShare={() => onShare(r.id, r.kind === 'final' ? 'Final render' : 'Quick preview render')} />
      ))}
    </ul>
  );
}
