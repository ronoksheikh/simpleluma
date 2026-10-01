import type { SceneTiming } from '@luma/motion/types';
import { RenderPage, formatErrors } from './browser.js';

export interface CheckReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  timeline: SceneTiming[];
  duration: number;
  frames: number;
  sampled: number;
}

/**
 * Load the working tree like the preview does and draw sample frames across the whole video (every scene, its
 * start, middle and end), collecting load errors, scenes that throw, and frames with nothing on them.
 */
export async function checkVideo(projectId: string): Promise<CheckReport> {
  let page: RenderPage;
  try {
    page = await RenderPage.open(projectId, 'work');
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)], warnings: [], timeline: [], duration: 0, frames: 0, sampled: 0 };
  }
  try {
    const loadErrors = await page.errors();
    const { fps, frames } = await page.info().catch(() => ({ fps: 0, frames: 0 }));
    if (!frames) return { ok: false, errors: loadErrors.length ? [formatErrors(loadErrors)] : ['The video could not be loaded (check video.json).'], warnings: [], timeline: [], duration: 0, frames: 0, sampled: 0 };
    const timeline = await page.timeline();
    const times = new Set<number>();
    const add = (t: number): void => void times.add(Math.min(frames - 1, Math.max(0, Math.round(t * fps))));
    const duration = frames / fps;
    for (let i = 0; i <= 10; i++) add((duration * i) / 10);
    for (const s of timeline.filter((x) => !x.overlay)) [0.02, 0.5, 0.98].forEach((k) => add(s.start + s.duration * k));
    const warnings: string[] = [];
    const empty: number[] = [];
    for (const index of [...times].sort((a, b) => a - b)) {
      const stats = await page.stats(index);
      if (!stats.bounds) empty.push(index / fps);
    }
    const errors = (await page.errors()).map((e) => `${e.path}${e.time !== undefined ? ` at ${e.time.toFixed(2)}s` : ''}: ${e.message}`);
    if (!timeline.length) warnings.push('There are no scenes yet (scenes/*.js).');
    // An empty first or last instant is a normal fade; empty frames in the middle usually are not.
    const middle = empty.filter((t) => t > 0.3 && t < duration - 0.3);
    if (middle.length) warnings.push(`Nothing but background is visible at ${middle.map((t) => `${t.toFixed(2)}s`).join(', ')}.`);
    const covered = (t: number): boolean => timeline.some((s) => !s.overlay && t >= s.start && t < s.start + s.duration);
    const gaps: string[] = [];
    for (let t = 0; t < duration; t += 0.25) if (!covered(t)) gaps.push(t.toFixed(2));
    if (gaps.length && timeline.some((s) => !s.overlay)) warnings.push(`No scene covers ${gaps.length > 6 ? `${gaps.slice(0, 6).join(', ')}s…` : `${gaps.join(', ')}s`}.`);
    return { ok: errors.length === 0, errors, warnings, timeline, duration, frames, sampled: times.size };
  } finally {
    await page.close();
  }
}

export function formatReport(r: CheckReport): string {
  const lines = [
    r.ok ? `Check passed: the video loads and ${r.sampled} sampled frames draw without errors.` : 'Check FAILED.',
    ...r.errors.map((e) => `Error: ${e}`),
    ...r.warnings.map((w) => `Warning: ${w}`),
  ];
  if (r.timeline.length) {
    lines.push('Timeline:', ...r.timeline.map((s) => `- ${s.path}: ${s.overlay ? 'overlay, whole video' : `${s.start.toFixed(2)}s–${(s.start + s.duration).toFixed(2)}s`}`));
  }
  return lines.join('\n');
}
