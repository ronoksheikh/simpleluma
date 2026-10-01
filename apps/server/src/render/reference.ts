import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { randomToken } from '../lib/crypto.js';
import { treeToken } from '../routes/tree.js';
import { getBrowser } from './browser.js';
import { framesDir } from './frame.js';

const exec = promisify(execFile);

/** Public CDNs that motion demos load libraries from. Everything else (other than the project) stays blocked. */
const CDNS = ['https://cdnjs.cloudflare.com/', 'https://cdn.jsdelivr.net/', 'https://unpkg.com/', 'https://esm.sh/', 'https://fonts.googleapis.com/', 'https://fonts.gstatic.com/', 'https://cdn.skypack.dev/', 'https://ga.jspm.io/'];

export interface ReferenceShot {
  file: string;
  name: string;
  times: number[];
  title: string;
  scripts: string[];
  duration: number | null;
}

/**
 * Open an HTML motion reference with a controlled clock and photograph it at the given seconds.
 * The clock drives timers, requestAnimationFrame (GSAP, Three.js, canvas loops) and CSS/Web Animations.
 */
export async function shootReference(projectId: string, path: string, times: number[], width = 1280, height = 720): Promise<ReferenceShot> {
  const context = await (await getBrowser()).newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const origin = `http://127.0.0.1:${config.port}`;
  const base = `${origin}/t/${treeToken(projectId, 'work', 600_000)}/`;
  await page.route('**/*', (route) => {
    const url = route.request().url();
    const ok = url.startsWith(base) || url.startsWith('data:') || url.startsWith('blob:') || CDNS.some((c) => url.startsWith(c));
    return ok ? route.continue() : route.abort();
  });
  const dir = await mkdtemp(join(tmpdir(), 'luma-ref-'));
  try {
    const clockStart = Date.UTC(2025, 0, 1);
    await page.clock.install({ time: clockStart });
    await page.clock.pauseAt(clockStart + 1);
    await page.goto(`${base}${path.split('/').map(encodeURIComponent).join('/')}`, { waitUntil: 'load', timeout: 30_000 });
    const sorted = [...new Set(times.map((t) => Math.max(0, Math.min(600, t))))].sort((a, b) => a - b).slice(0, 9);
    let now = 0;
    const shots: string[] = [];
    for (const [i, t] of sorted.entries()) {
      if (t > now) await page.clock.runFor(Math.round((t - now) * 1000));
      now = t;
      await page.evaluate((ms) => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = ms; }), t * 1000).catch(() => undefined);
      const shot = join(dir, `s${i}.jpg`);
      await page.screenshot({ path: shot, type: 'jpeg', quality: 80 });
      shots.push(shot);
    }
    const info = await page.evaluate(() => ({
      title: document.title,
      scripts: Array.from(document.scripts).map((s) => s.src || `inline (${s.textContent?.length ?? 0} chars)`).slice(0, 12),
      duration: Math.max(0, ...document.getAnimations().map((a) => Number(a.effect?.getComputedTiming().endTime ?? 0))) / 1000 || null,
    }));
    // One contact sheet: up to three per row, labelled by time.
    const cols = Math.min(3, shots.length);
    const rows = Math.ceil(shots.length / cols);
    const name = `ref-${randomToken(6)}.jpg`;
    await mkdir(framesDir(projectId), { recursive: true });
    const out = resolve(framesDir(projectId), name);
    const inputs = shots.flatMap((s) => ['-i', s]);
    const labelled = shots.map((_, i) => `[${i}:v]scale=640:-2,drawtext=text='${sorted[i]!.toFixed(2)}s':x=12:y=12:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=8[v${i}]`);
    const pad = Array.from({ length: cols * rows - shots.length }, (_, i) => `color=c=black:s=640x360:d=1[p${i}]`);
    const all = [...shots.map((_, i) => `[v${i}]`), ...pad.map((_, i) => `[p${i}]`)].join('');
    const graph = [...labelled, ...pad, `${all}xstack=inputs=${cols * rows}:layout=${layout(cols, rows)}:fill=black[out]`].join(';');
    if (cols * rows === 1) await exec('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', labelled[0]!.replace('[v0]', '[out]'), '-map', '[out]', '-frames:v', '1', out]);
    else await exec('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', graph, '-map', '[out]', '-frames:v', '1', out]);
    return { file: out, name, times: sorted, ...info };
  } finally {
    await context.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
}

function layout(cols: number, rows: number): string {
  const cells: string[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push(`${c === 0 ? '0' : Array.from({ length: c }, () => 'w0').join('+')}_${r === 0 ? '0' : Array.from({ length: r }, () => 'h0').join('+')}`);
  return cells.join('|');
}

export const readShot = (file: string): Promise<Buffer> => readFile(file);
