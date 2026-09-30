import type { Frame, Manifest, SceneError, SceneModule, SceneTiming, VideoConfig, VoiceClip, VoiceTrack } from '../types.js';

interface LoadedScene extends SceneTiming {
  draw: SceneModule['draw'];
}

const realClock = { random: Math.random, now: Date.now, perf: performance.now.bind(performance) };

function forbid(name: string, instead: string): () => never {
  return () => {
    throw new Error(`${name} is not allowed in scenes (frames must depend only on t). ${instead}`);
  };
}

/** Run `fn` with nondeterministic APIs disabled, so a scene can never depend on wall-clock time or chance. */
function deterministic<T>(fn: () => T): T {
  Math.random = forbid('Math.random', 'Use rng(seed) from "luma".');
  Date.now = forbid('Date.now', 'Use the time argument t.');
  performance.now = forbid('performance.now', 'Use the time argument t.');
  try {
    return fn();
  } finally {
    Math.random = realClock.random;
    Date.now = realClock.now;
    performance.now = realClock.perf;
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `${url}: ${res.status}`);
  }
  return (await res.json()) as T;
}

/** Loads a project's scenes and draws any frame of it. */
export class Engine {
  video!: VideoConfig;
  manifest!: Manifest;
  voice: VoiceTrack = { clips: [], words: [] };
  errors: SceneError[] = [];
  private scenes: LoadedScene[] = [];

  constructor(readonly base: string) {}

  get frames(): number {
    return Math.round(this.video.duration * this.video.fps);
  }

  async load(): Promise<void> {
    this.errors = [];
    this.manifest = await fetchJson<Manifest>(`${this.base}/__manifest`);
    this.video = this.manifest.video;
    const voiceClips = await Promise.all(
      this.manifest.voice.map(async (path) => ({ ...(await fetchJson<VoiceClip>(`${this.base}/${path}`)), name: path })),
    );
    this.voice = {
      clips: voiceClips,
      words: voiceClips.flatMap((c) => c.words.map((w) => ({ ...w, start: c.at + w.start, end: c.at + w.end, clip: c.name }))),
    };
    this.scenes = [];
    for (const path of this.manifest.scenes) {
      try {
        this.scenes.push(this.toScene(path, await import(/* @vite-ignore */ `${this.base}/${path}`)));
      } catch (e) {
        this.fail(path, e);
      }
    }
  }

  timeline(): SceneTiming[] {
    return this.scenes.map(({ path, start, duration, overlay }) => ({ path, start, duration, overlay }));
  }

  /** Draw frame `index` onto `ctx`, scaling video coordinates by `scale`. */
  drawFrame(ctx: CanvasRenderingContext2D, index: number, scale = 1): void {
    const { width, height, fps, bpm, background } = this.video;
    const time = index / fps;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = background ?? '#000000';
    ctx.fillRect(0, 0, width + 2, height + 2);
    const active = this.scenes.filter((s) => s.overlay || (time >= s.start && time < s.start + s.duration));
    const ordered = [...active.filter((s) => !s.overlay), ...active.filter((s) => s.overlay)];
    for (const scene of ordered) {
      const t = time - scene.start;
      const frame: Frame = {
        time, t, index, width, height, fps, bpm,
        duration: scene.duration,
        progress: Math.min(1, t / scene.duration),
        beat: (time * bpm) / 60,
        voice: this.voice,
      };
      ctx.save();
      try {
        deterministic(() => scene.draw(ctx, t, frame));
      } catch (e) {
        this.fail(scene.path, e, time);
      } finally {
        ctx.restore();
      }
    }
  }

  private toScene(path: string, mod: Partial<SceneModule>): LoadedScene {
    if (typeof mod.draw !== 'function') throw new Error('Scene must export a draw(ctx, t) function.');
    const overlay = mod.overlay === true;
    const start = overlay ? 0 : (mod.start ?? 0);
    const duration = overlay ? this.video.duration : (mod.duration ?? this.video.duration - start);
    if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) {
      throw new Error('Scene `start` and `duration` must be numbers (seconds) and duration must be positive.');
    }
    return { path, start, duration, overlay, draw: mod.draw };
  }

  private fail(path: string, e: unknown, time?: number): void {
    const message = e instanceof Error ? e.message : String(e);
    if (!this.errors.some((x) => x.path === path && x.message === message)) this.errors.push({ path, message, time });
  }
}
