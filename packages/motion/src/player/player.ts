import { Engine } from './engine.js';
import { Soundtrack, wavBase64 } from './audio.js';
import type { SceneError, SceneTiming } from '../types.js';

type ImageFormat = 'png' | 'jpeg';

const params = new URLSearchParams(location.search);
const base = (params.get('base') ?? '').replace(/\/$/, '');
const renderMode = params.get('mode') === 'render';

const engine = new Engine(base);
const soundtrack = new Soundtrack(engine);
const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
const ctx = canvas.getContext('2d', { alpha: false })!;

function sizeCanvas(width: number): number {
  const scale = width / engine.video.width;
  canvas.width = Math.round(engine.video.width * scale);
  canvas.height = Math.round(engine.video.height * scale);
  return scale;
}

function notifyParent(errors: SceneError[]): void {
  parent.postMessage({ luma: 'status', errors, duration: engine.video?.duration ?? 0, timeline: engine.video ? engine.timeline() : [] }, '*');
}

async function loadProject(): Promise<void> {
  await document.fonts.load('500 32px "Inter Variable"');
  await engine.load();
  await soundtrack.load();
}

/** Tools for the headless renderer (Playwright) to drive frame by frame. */
interface RenderApi {
  ready: Promise<void>;
  timeline(): SceneTiming[];
  errors(): SceneError[];
  info(): { width: number; height: number; fps: number; frames: number };
  frame(index: number, height: number, format: ImageFormat, quality: number): string;
  stats(index: number): FrameStats;
  audio(): Promise<string | null>;
}

interface FrameStats {
  coverage: number;
  brightness: number;
  colors: string[];
  bounds: [number, number, number, number] | null;
}

function frameStats(index: number): FrameStats {
  const w = 96;
  const h = Math.max(1, Math.round((w * engine.video.height) / engine.video.width));
  const small = new OffscreenCanvas(w, h);
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  const scale = sizeCanvas(w * 8);
  engine.drawFrame(ctx, index, scale);
  sctx.drawImage(canvas, 0, 0, w, h);
  const { data } = sctx.getImageData(0, 0, w, h);
  const bg = [data[0]!, data[1]!, data[2]!];
  let differing = 0;
  let luma = 0;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  const buckets = new Map<string, number>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
      luma += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (Math.abs(r - bg[0]!) + Math.abs(g - bg[1]!) + Math.abs(b - bg[2]!) > 24) {
        differing++;
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
      const key = [r, g, b].map((v) => Math.round(v / 32) * 32).map((v) => Math.min(255, v).toString(16).padStart(2, '0')).join('');
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }
  const top = [...buckets].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([hex]) => `#${hex}`);
  return {
    coverage: Math.round((differing / (w * h)) * 100) / 100,
    brightness: Math.round(luma / (w * h) / 2.55) / 100,
    colors: top,
    bounds: maxX < 0 ? null : [minX / w, minY / h, (maxX + 1) / w, (maxY + 1) / h].map((v) => Math.round(v * 100) / 100) as FrameStats['bounds'],
  };
}

function installRenderApi(ready: Promise<void>): void {
  const api: RenderApi = {
    ready,
    timeline: () => engine.timeline(),
    errors: () => engine.errors,
    info: () => ({ width: engine.video.width, height: engine.video.height, fps: engine.video.fps, frames: engine.frames }),
    frame(index, height, format, quality) {
      const scale = height / engine.video.height;
      canvas.width = 2 * Math.round((engine.video.width * scale) / 2);
      canvas.height = height;
      engine.drawFrame(ctx, index, scale);
      if (engine.errors.length) throw new Error(engine.errors.map((e) => `${e.path}${e.time !== undefined ? ` at ${e.time.toFixed(2)}s` : ''}: ${e.message}`).join('\n'));
      return canvas.toDataURL(`image/${format}`, quality).split(',')[1]!;
    },
    stats: frameStats,
    async audio() {
      if (soundtrack.isEmpty) return null;
      const rate = 44100;
      const offline = new OfflineAudioContext(2, Math.ceil(engine.video.duration * rate), rate);
      await soundtrack.prepare(offline);
      await soundtrack.schedule(offline, 0, offline.destination);
      return wavBase64(await offline.startRendering());
    },
  };
  (window as unknown as { __luma: RenderApi }).__luma = api;
}

// ---------------------------------------------------------------------------------------------
// Live player
// ---------------------------------------------------------------------------------------------

const fmt = (s: number): string => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

class Player {
  private time = Number(params.get('t') ?? 0);
  /** While nothing has been played yet, show this moment instead of a (usually empty) first frame. */
  private poster = Number(params.get('poster') ?? 0);
  private touched = this.time > 0;
  private ac: AudioContext | null = null;
  private origin = 0;
  private playing = false;
  private muted = false;
  private master: GainNode | null = null;
  private raf = 0;
  private shownErrors = 0;
  private lastPost = 0;
  private readonly el = {
    play: document.querySelector<HTMLButtonElement>('#play')!,
    scrub: document.querySelector<HTMLInputElement>('#scrub')!,
    time: document.querySelector<HTMLElement>('#time')!,
    mute: document.querySelector<HTMLButtonElement>('#mute')!,
    full: document.querySelector<HTMLButtonElement>('#full')!,
    errors: document.querySelector<HTMLElement>('#errors')!,
    big: document.querySelector<HTMLButtonElement>('#big')!,
  };

  constructor() {
    const toggle = (): void => void (this.playing ? this.pause() : this.play());
    this.el.play.onclick = toggle;
    this.el.big.onclick = toggle;
    canvas.onclick = toggle;
    // Dragging the scrubber pauses the sound; it resumes when the drag ends.
    let resume = false;
    this.el.scrub.onpointerdown = () => {
      resume = this.playing;
      if (resume) this.pause();
    };
    this.el.scrub.oninput = () => this.seek(Number(this.el.scrub.value) / 1000);
    this.el.scrub.onchange = () => {
      if (resume) void this.play();
      resume = false;
    };
    this.el.mute.onclick = () => {
      this.muted = !this.muted;
      if (this.master) this.master.gain.value = this.muted ? 0 : 1;
      this.el.mute.dataset.on = String(this.muted);
    };
    this.el.full.onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
    document.onkeydown = (e) => {
      if (e.code === 'Space') { e.preventDefault(); toggle(); }
      if (e.code === 'ArrowLeft') this.seek(this.time - 1);
      if (e.code === 'ArrowRight') this.seek(this.time + 1);
    };
    new ResizeObserver(() => this.fit()).observe(document.querySelector('#frame')!);
    // The studio around the frame can drive the player (scene chips, keyboard shortcuts).
    window.addEventListener('message', (e) => {
      if (e.source !== parent) return;
      const msg = e.data as { luma?: string; t?: number };
      if (msg?.luma === 'seek' && typeof msg.t === 'number') this.seek(msg.t);
      if (msg?.luma === 'play') void this.play();
      if (msg?.luma === 'pause') this.pause();
      if (msg?.luma === 'toggle') toggle();
    });
  }

  async start(): Promise<void> {
    this.el.scrub.max = String(Math.round(engine.video.duration * 1000));
    this.fit();
    this.showErrors();
    this.seek(this.time, false);
  }

  private fit(): void {
    const box = document.querySelector('#frame')!.getBoundingClientRect();
    const width = Math.min(engine.video.width, Math.max(960, Math.round(box.width * devicePixelRatio)));
    sizeCanvas(width);
    this.draw();
  }

  private draw(): void {
    const at = this.touched ? this.time : this.poster;
    const frame = Math.min(engine.frames - 1, Math.max(0, Math.floor(at * engine.video.fps)));
    engine.drawFrame(ctx, frame, canvas.width / engine.video.width);
    this.el.scrub.value = String(Math.round(this.time * 1000));
    this.el.time.textContent = `${fmt(this.time)} / ${fmt(engine.video.duration)}`;
    if (engine.errors.length !== this.shownErrors) this.showErrors();
  }

  private showErrors(): void {
    const errors = engine.errors;
    this.shownErrors = errors.length;
    this.el.errors.hidden = errors.length === 0;
    this.el.errors.textContent = errors.map((e) => `${e.path}${e.time !== undefined ? ` @ ${e.time.toFixed(2)}s` : ''}: ${e.message}`).join('\n');
    notifyParent(errors);
  }

  seek(t: number, user = true): void {
    this.touched ||= user;
    const was = this.playing;
    if (was) this.stopAudio();
    this.time = Math.min(engine.video.duration, Math.max(0, t));
    this.draw();
    parent.postMessage({ luma: 'time', t: this.time }, '*');
    if (was) void this.startAudio();
  }

  async play(): Promise<void> {
    this.touched = true;
    if (this.time >= engine.video.duration - 0.05) this.time = 0;
    this.playing = true;
    document.body.dataset.playing = 'true';
    await this.startAudio();
    cancelAnimationFrame(this.raf);
    const tick = (): void => {
      if (!this.playing || !this.ac) return;
      this.time = Math.min(engine.video.duration, this.ac.currentTime - this.origin);
      this.draw();
      if (performance.now() - this.lastPost > 100) {
        this.lastPost = performance.now();
        parent.postMessage({ luma: 'time', t: this.time, playing: true }, '*');
      }
      if (this.time >= engine.video.duration) return this.pause();
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  pause(): void {
    if (this.ac) this.time = Math.min(engine.video.duration, this.ac.currentTime - this.origin);
    this.playing = false;
    document.body.dataset.playing = 'false';
    cancelAnimationFrame(this.raf);
    this.stopAudio();
    this.draw();
    parent.postMessage({ luma: 'time', t: this.time, playing: false }, '*');
  }

  private async startAudio(): Promise<void> {
    const ac = new AudioContext();
    this.ac = ac;
    this.origin = ac.currentTime - this.time;
    this.master = ac.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(ac.destination);
    try {
      await soundtrack.prepare(ac);
      await soundtrack.schedule(ac, this.origin, this.master);
    } catch (e) {
      engine.errors.push({ path: 'audio', message: e instanceof Error ? e.message : String(e) });
      this.showErrors();
    }
  }

  private stopAudio(): void {
    void this.ac?.close();
    this.ac = null;
    this.master = null;
  }
}

const ready = loadProject().catch((e: unknown) => {
  engine.errors.push({ path: 'project', message: e instanceof Error ? e.message : String(e) });
});

if (renderMode) {
  installRenderApi(ready);
} else {
  void ready.then(async () => {
    if (!engine.video) {
      const box = document.querySelector<HTMLElement>('#errors')!;
      box.hidden = false;
      box.textContent = engine.errors.map((e) => `${e.path}: ${e.message}`).join('\n');
      notifyParent(engine.errors);
      return;
    }
    await new Player().start();
    document.body.dataset.ready = 'true';
  });
}
