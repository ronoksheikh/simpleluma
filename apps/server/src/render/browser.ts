import { chromium, type Browser, type Page } from 'playwright-core';
import type { SceneError, SceneTiming } from '@luma/motion/types';
import { config } from '../config.js';
import { treeToken, type TreeRef } from '../routes/tree.js';

let browser: Promise<Browser> | null = null;

export function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = chromium
      .launch({
        executablePath: config.chromiumPath,
        // WebGL (Three.js scenes) runs on SwiftShader, so it works without a GPU and draws the same everywhere.
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required', '--font-render-hinting=none', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
      })
      .then((b) => {
        b.on('disconnected', () => (browser = null));
        return b;
      });
  }
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (browser) await (await browser).close();
}

export interface FrameStats {
  coverage: number;
  brightness: number;
  colors: string[];
  bounds: [number, number, number, number] | null;
}

interface PageApi {
  ready: Promise<void>;
  timeline(): SceneTiming[];
  errors(): SceneError[];
  info(): { width: number; height: number; fps: number; frames: number };
  frame(index: number, height: number, format: 'png' | 'jpeg', quality: number): string;
  stats(index: number): FrameStats;
  audio(): Promise<string | null>;
}

const FRAME_TIMEOUT_MS = 60_000;

export const formatErrors = (errors: SceneError[]): string =>
  errors.map((e) => `${e.path}${e.time !== undefined ? ` at ${e.time.toFixed(2)}s` : ''}: ${e.message}`).join('\n');

/** A headless page that has loaded a project and can draw any of its frames. */
export class RenderPage {
  private constructor(private readonly page: Page) {}

  static async open(projectId: string, ref: TreeRef): Promise<RenderPage> {
    const page = await (await getBrowser()).newPage({ viewport: { width: 1280, height: 720 } });
    const origin = `http://127.0.0.1:${config.port}`;
    const token = treeToken(projectId, ref, 3600_000);
    // Scenes are generated code: the page may only talk to this project's files and the player itself.
    await page.route('**/*', (route) => {
      const url = route.request().url();
      const allowed = url.startsWith('data:') || url.startsWith('blob:') || url.startsWith(`${origin}/motion/`) || url.startsWith(`${origin}/t/${token}/`) || url.startsWith(`${origin}/player`);
      return allowed ? route.continue() : route.abort();
    });
    await page.goto(`${origin}/player?mode=render&base=${encodeURIComponent(`/t/${token}`)}`);
    const rp = new RenderPage(page);
    await rp.call(() => window.__luma.ready);
    return rp;
  }

  private async call<A, T>(fn: (arg: A) => T | Promise<T>, arg?: A): Promise<Awaited<T>> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        void this.close();
        reject(new Error(`A scene took longer than ${FRAME_TIMEOUT_MS / 1000}s to draw a frame. Check for endless loops.`));
      }, FRAME_TIMEOUT_MS);
    });
    try {
      return await Promise.race([this.page.evaluate(fn as (arg: unknown) => T | Promise<T>, arg) as Promise<Awaited<T>>, timeout]);
    } catch (e) {
      // Playwright prefixes page errors with its own call name; keep the message the scene author needs.
      throw new Error(e instanceof Error ? e.message.replace(/^page\.evaluate: (Error: )?/, '').split('\n    at ')[0]! : String(e));
    } finally {
      clearTimeout(timer);
    }
  }

  async timeline(): Promise<SceneTiming[]> {
    return this.call(() => window.__luma.timeline());
  }

  async errors(): Promise<SceneError[]> {
    return this.call(() => window.__luma.errors());
  }

  async info() {
    return this.call(() => window.__luma.info());
  }

  /** Image data of frame `index` drawn at `height` pixels tall. Throws if a scene fails. */
  async frame(index: number, height: number, format: 'png' | 'jpeg', quality = 0.92): Promise<Buffer> {
    const data = await this.call(
      ([i, h, f, q]: [number, number, 'png' | 'jpeg', number]) => window.__luma.frame(i, h, f, q),
      [index, height, format, quality],
    );
    return Buffer.from(data, 'base64');
  }

  async stats(index: number): Promise<FrameStats> {
    return this.call((i: number) => window.__luma.stats(i), index);
  }

  /** The whole soundtrack as a WAV file, or `null` when the project has none. */
  async audioWav(): Promise<Buffer | null> {
    const data = await this.call(() => window.__luma.audio());
    return data ? Buffer.from(data, 'base64') : null;
  }

  async close(): Promise<void> {
    await this.page.close().catch(() => undefined);
  }
}

declare global {
  interface Window {
    __luma: PageApi;
  }
}

/** Run `fn` in an empty page with no network access (used to inspect attachments). */
export async function inBlankPage<R>(fn: (arg: { url: string }) => R | Promise<R>, arg: { url: string }): Promise<R> {
  const page = await (await getBrowser()).newPage();
  try {
    await page.route('**/*', (route) => (route.request().url().startsWith('data:') ? route.continue() : route.abort()));
    await page.goto('about:blank');
    return await page.evaluate(fn, arg);
  } finally {
    await page.close();
  }
}
