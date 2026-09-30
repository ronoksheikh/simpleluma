import { Button, Spinner } from '@heroui/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { clock } from '../../lib/format';
import type { VideoConfig } from '../../lib/types';
import { ShareIcon } from '../icons';

interface PlayerStatus {
  luma: 'status';
  errors: Array<{ path: string; message: string; time?: number }>;
}

/** The live preview: the project's own player in a sandboxed frame. It reloads (at the same time position) when files change. */
export function PreviewPanel({ projectId, video, reloadKey, head, onShare }: { projectId: string; video: VideoConfig | null; reloadKey: number; head: string | null; onShare: () => void }) {
  const { data: token } = useQuery({
    queryKey: ['preview-token', projectId],
    queryFn: () => api.post<{ base: string }>(`/api/projects/${projectId}/preview-token`),
    staleTime: 10 * 3600 * 1000,
  });
  const frame = useRef<HTMLIFrameElement>(null);
  const time = useRef(0);
  const [src, setSrc] = useState<string | null>(null);
  const [errors, setErrors] = useState<PlayerStatus['errors']>([]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      if (e.data?.luma === 'time') time.current = e.data.t as number;
      if (e.data?.luma === 'status') setErrors((e.data as PlayerStatus).errors);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Reload shortly after the last change so a burst of edits is one refresh.
  useEffect(() => {
    if (!token) return;
    const timer = setTimeout(() => setSrc(`/player?base=${encodeURIComponent(token.base)}&t=${time.current}&poster=${Math.round((video?.duration ?? 0) * 35) / 100}&r=${reloadKey}`), reloadKey === 0 ? 0 : 400);
    return () => clearTimeout(timer);
  }, [token, reloadKey]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-2xl bg-night p-0 [container-type:size]">
        {src ? (
          <iframe
            ref={frame}
            title="Live preview"
            src={src}
            sandbox="allow-scripts"
            allow="fullscreen; autoplay"
            allowFullScreen
            className="rounded-2xl border-0"
            style={{ aspectRatio: video ? `${video.width} / ${video.height}` : '16 / 9', width: 'min(100cqw, calc(100cqh * var(--ratio, 1.7778)))', ['--ratio' as string]: video ? video.width / video.height : 16 / 9 }}
          />
        ) : (
          <Spinner />
        )}
      </div>
      <div className="flex items-center justify-between gap-3 px-1 text-sm text-night/60">
        <span>
          {video ? `${video.width}×${video.height} · ${video.fps} fps · ${clock(video.duration)}` : 'No video.json yet'}
          {head && <span className="ml-2 font-mono text-xs">v {head.slice(0, 7)}</span>}
        </span>
        <Button size="sm" variant="secondary" onPress={onShare}><ShareIcon size={15} />Share preview</Button>
      </div>
      {errors.length > 0 && (
        <pre role="alert" className="thin-scroll max-h-28 overflow-auto whitespace-pre-wrap rounded-xl bg-danger/10 p-3 font-mono text-xs text-danger">
          {errors.map((e) => `${e.path}${e.time !== undefined ? ` @ ${e.time.toFixed(2)}s` : ''}: ${e.message}`).join('\n')}
        </pre>
      )}
    </div>
  );
}
