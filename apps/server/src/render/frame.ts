import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config } from '../config.js';
import { randomToken } from '../lib/crypto.js';
import * as gitRepo from '../lib/git.js';
import { projectDir } from '../projects/service.js';
import { RenderPage, formatErrors, type FrameStats } from './browser.js';

export interface CapturedFrame {
  file: string;
  name: string;
  time: number;
  stats: FrameStats;
  errors: string;
}

let active = 0;
const waiting: Array<() => void> = [];

/** Browser pages are heavy: at most three stills at a time. */
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 3) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

export const framesDir = (projectId: string): string => resolve(config.framesDir, projectId);

/** Draw one still of the working tree (the state the preview shows) at `seconds`. */
export function captureFrame(projectId: string, seconds: number, height = 540): Promise<CapturedFrame> {
  return limited(async () => {
    const page = await RenderPage.open(projectId, 'work');
    try {
      const { fps, frames } = await page.info();
      const index = Math.min(frames - 1, Math.max(0, Math.round(seconds * fps)));
      let jpeg: Buffer | null = null;
      let errors = '';
      try {
        jpeg = await page.frame(index, height, 'jpeg', 0.88);
      } catch (e) {
        errors = e instanceof Error ? e.message : String(e);
      }
      if (!jpeg) throw new Error(errors || formatErrors(await page.errors()));
      const name = `${randomToken(6)}.jpg`;
      await mkdir(framesDir(projectId), { recursive: true });
      const file = resolve(framesDir(projectId), name);
      await writeFile(file, jpeg);
      await pruneFrames(framesDir(projectId));
      return { file, name, time: index / fps, stats: await page.stats(index), errors };
    } finally {
      await page.close();
    }
  });
}

/** Stills the agent captured are only useful for a while; thumbnails stay until the project changes. */
async function pruneFrames(dir: string): Promise<void> {
  const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
  for (const name of await readdir(dir)) {
    const file = resolve(dir, name);
    if (!name.startsWith('thumb-') && (await stat(file)).mtimeMs < cutoff) await rm(file, { force: true });
  }
}

/** Cached poster image for the dashboard, refreshed when the project's latest commit changes. */
export async function thumbnail(projectId: string): Promise<string | null> {
  const sha = await gitRepo.head(projectDir(projectId));
  if (!sha) return null;
  const file = resolve(framesDir(projectId), `thumb-${sha.slice(0, 12)}.jpg`);
  if (existsSync(file)) return file;
  return limited(async () => {
    const page = await RenderPage.open(projectId, sha);
    try {
      const { frames } = await page.info();
      const jpeg = await page.frame(Math.min(frames - 1, Math.round(frames * 0.35)), 360, 'jpeg', 0.85);
      await mkdir(framesDir(projectId), { recursive: true });
      for (const old of await readdir(framesDir(projectId))) if (old.startsWith('thumb-')) await rm(resolve(framesDir(projectId), old), { force: true });
      await writeFile(file, jpeg);
      return file;
    } catch {
      return null;
    } finally {
      await page.close();
    }
  });
}
