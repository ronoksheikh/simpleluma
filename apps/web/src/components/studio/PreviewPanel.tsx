import { Button, Spinner, Tooltip } from '@heroui/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { clock, sceneLabel, seconds } from '../../lib/format';
import { notify } from '../../lib/notify';
import { useStudio } from '../../lib/studio';
import type { RenderView, SceneTiming, VideoConfig } from '../../lib/types';
import { AlertIcon, CrosshairIcon, FilmIcon, PlusIcon, ShareIcon } from '../icons';

interface PlayerStatus {
  luma: 'status';
  errors: Array<{ path: string; message: string; time?: number }>;
  timeline?: SceneTiming[];
  duration?: number;
}

const SEGMENT_COLORS = ['#2970EC', '#5DAEFF', '#1557D1', '#3E8BFF', '#7FC0FF', '#2F64D6'];

function SceneTrack({ timeline, duration, time, onSeek, onInclude }: { timeline: SceneTiming[]; duration: number; time: number; onSeek: (t: number) => void; onInclude: (s: SceneTiming) => void }) {
  const scenes = timeline.filter((s) => !s.overlay);
  const overlays = timeline.filter((s) => s.overlay);
  const track = useRef<HTMLDivElement>(null);
  if (!duration) return null;
  const scrub = (clientX: number) => {
    const box = track.current!.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(duration, ((clientX - box.left) / box.width) * duration)));
  };
  // Overlapping scenes (crossfades) stack in lanes.
  const lanes: SceneTiming[][] = [];
  for (const s of scenes) {
    const lane = lanes.find((l) => l.every((o) => o.start + o.duration <= s.start + 0.001 || s.start + s.duration <= o.start + 0.001));
    if (lane) lane.push(s);
    else lanes.push([s]);
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div
        ref={track}
        className="relative cursor-pointer select-none rounded-xl bg-ink/[0.04] p-1"
        onPointerDown={(e) => { if ((e.target as HTMLElement).closest('button')) return; scrub(e.clientX); }}
        role="slider"
        aria-label="Timeline"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={time}
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'ArrowRight') onSeek(Math.min(duration, time + 0.5)); if (e.key === 'ArrowLeft') onSeek(Math.max(0, time - 0.5)); }}
      >
        {lanes.slice(0, 3).map((lane, li) => (
          <div key={li} className="relative h-8 [&+&]:mt-1">
            {lane.map((s) => {
              const i = scenes.indexOf(s);
              return (
                <div
                  key={s.path}
                  className="group absolute inset-y-0 flex items-center overflow-hidden rounded-lg px-2 text-[11.5px] font-medium text-white"
                  style={{ left: `${(s.start / duration) * 100}%`, width: `calc(${(s.duration / duration) * 100}% - 2px)`, background: SEGMENT_COLORS[i % SEGMENT_COLORS.length] }}
                  title={`${s.path} · ${seconds(s.start)}–${seconds(s.start + s.duration)}`}
                >
                  <span className="truncate">{sceneLabel(s.path)}</span>
                  <Tooltip delay={200}>
                    <Tooltip.Trigger>
                      <button type="button" aria-label={`Include ${sceneLabel(s.path)} in the chat`} onClick={() => onInclude(s)} className="ml-auto hidden size-5 shrink-0 place-items-center rounded-md bg-white/25 hover:bg-white/40 group-hover:grid">
                        <PlusIcon size={12} />
                      </button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>Include this scene for changes</Tooltip.Content>
                  </Tooltip>
                </div>
              );
            })}
          </div>
        ))}
        <div className="pointer-events-none absolute inset-y-0 w-0.5 rounded bg-ink" style={{ left: `calc(${(time / duration) * 100}% )` }}>
          <span className="absolute -top-1 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-ink" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {scenes.map((s) => (
          <button key={s.path} type="button" onClick={() => onSeek(s.start + Math.min(0.3, s.duration / 2))} className={`rounded-lg border px-2 py-0.5 text-[11.5px] transition-colors ${time >= s.start && time < s.start + s.duration ? 'border-lumablue/40 bg-lumablue/[0.07] text-royal' : 'border-ink/10 text-ink/60 hover:border-ink/25'}`}>
            {sceneLabel(s.path)} <span className="text-ink/40">{seconds(s.start)}</span>
          </button>
        ))}
        {overlays.map((s) => <span key={s.path} className="rounded-lg border border-dashed border-ink/15 px-2 py-0.5 text-[11.5px] text-ink/50">{sceneLabel(s.path)} · overlay</span>)}
      </div>
    </div>
  );
}

/** The live preview: the project's own player in a sandboxed frame. It reloads (at the same moment) when files change. */
export function PreviewPanel({ video, reloadKey, head, onShare }: { video: VideoConfig | null; reloadKey: number; head: string | null; onShare: () => void }) {
  const { projectId, addContext, send, chat, onSeek, setTab } = useStudio();
  const { data: token } = useQuery({
    queryKey: ['preview-token', projectId],
    queryFn: () => api.post<{ base: string }>(`/api/projects/${projectId}/preview-token`),
    staleTime: 10 * 3600 * 1000,
  });
  const { data: renders = [] } = useQuery({ queryKey: ['renders', projectId], queryFn: () => api.get<RenderView[]>(`/api/projects/${projectId}/renders`) });
  const frame = useRef<HTMLIFrameElement>(null);
  const time = useRef(0);
  const [now, setNow] = useState(0);
  const [src, setSrc] = useState<string | null>(null);
  const [status, setStatus] = useState<PlayerStatus | null>(null);
  const [starting, setStarting] = useState<'preview' | 'final' | null>(null);
  const rendering = renders.some((r) => r.status === 'rendering' || r.status === 'queued');

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      if (e.data?.luma === 'time') {
        time.current = e.data.t as number;
        setNow(e.data.t as number);
      }
      if (e.data?.luma === 'status') setStatus(e.data as PlayerStatus);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const seek = (t: number) => {
    time.current = t;
    setNow(t);
    frame.current?.contentWindow?.postMessage({ luma: 'seek', t }, '*');
  };
  useEffect(() => onSeek(seek), [onSeek]);

  // Reload shortly after the last change so a burst of edits is one refresh.
  useEffect(() => {
    if (!token) return;
    const timer = setTimeout(() => setSrc(`/player?base=${encodeURIComponent(token.base)}&t=${time.current}&poster=${Math.round((video?.duration ?? 0) * 35) / 100}&r=${reloadKey}`), reloadKey === 0 ? 0 : 400);
    return () => clearTimeout(timer);
  }, [token, reloadKey]);

  const startRender = async (kind: 'preview' | 'final') => {
    setStarting(kind);
    try {
      await api.post(`/api/projects/${projectId}/renders`, { kind });
      setTab('renders');
    } catch (e) {
      notify.error(e instanceof Error ? e.message : 'Could not start the render.');
    } finally {
      setStarting(null);
    }
  };

  const errors = status?.errors ?? [];
  const errorText = errors.map((e) => `${e.path}${e.time !== undefined ? ` @ ${e.time.toFixed(2)}s` : ''}: ${e.message}`).join('\n');
  const ratio = video ? video.width / video.height : 16 / 9;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex min-h-[200px] flex-1 items-center justify-center overflow-hidden rounded-2xl bg-stage [container-type:size]">
        {src ? (
          <iframe
            ref={frame}
            title="Live preview"
            src={src}
            sandbox="allow-scripts"
            allow="fullscreen; autoplay"
            allowFullScreen
            className="rounded-xl border-0"
            style={{ aspectRatio: `${ratio}`, width: `min(100cqw, calc(100cqh * ${ratio}))` }}
          />
        ) : (
          <Spinner />
        )}
      </div>

      {status?.timeline && status.timeline.length > 0 && (
        <SceneTrack timeline={status.timeline} duration={status.duration ?? video?.duration ?? 0} time={now} onSeek={seek} onInclude={(s) => addContext({ type: 'scene', path: s.path, start: s.start, duration: s.duration, label: sceneLabel(s.path) })} />
      )}

      {errors.length > 0 && (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-danger/20 bg-danger/[0.05] p-3">
          <AlertIcon size={16} className="mt-0.5 shrink-0 text-danger" />
          <pre className="thin-scroll max-h-24 min-w-0 flex-1 overflow-auto whitespace-pre-wrap font-mono text-[11.5px] text-danger">{errorText}</pre>
          <Button size="sm" variant="secondary" isDisabled={chat.running} onPress={() => void send(`The preview shows these errors. Find the cause and fix them, then verify with check_video:\n\n${errorText}`)}>Ask the Director to fix</Button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-x-1.5 gap-y-2">
        <span className="mr-auto w-full text-[12px] text-ink/50 2xl:w-auto">
          {video ? `${video.width}×${video.height} · ${video.fps} fps · ${clock(video.duration)}` : 'No video.json yet'}
          {head && <span className="ml-2 font-mono text-[11px] text-ink/35">{head.slice(0, 7)}</span>}
        </span>
        <Tooltip delay={300}>
          <Tooltip.Trigger>
            <Button size="sm" variant="ghost" onPress={() => addContext({ type: 'frame', time: time.current })}><CrosshairIcon size={15} />Include frame</Button>
          </Tooltip.Trigger>
          <Tooltip.Content>Point the Director at the moment {seconds(now)}</Tooltip.Content>
        </Tooltip>
        <Tooltip delay={300}>
          <Tooltip.Trigger>
            <Button size="sm" variant="ghost" isIconOnly aria-label="Share" onPress={onShare}><ShareIcon size={15} /></Button>
          </Tooltip.Trigger>
          <Tooltip.Content>Share a link to this version</Tooltip.Content>
        </Tooltip>
        <Button size="sm" variant="secondary" isPending={starting === 'preview'} isDisabled={rendering} onPress={() => void startRender('preview')}>Quick 480p</Button>
        <Button size="sm" isPending={starting === 'final'} isDisabled={rendering} onPress={() => void startRender('final')}><FilmIcon size={15} />Render 1080p</Button>
      </div>
    </div>
  );
}
