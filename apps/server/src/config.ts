import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const dataDir = resolve(process.env.DATA_DIR ?? resolve(root, 'data'));

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  root,
  dataDir,
  projectsDir: resolve(dataDir, 'projects'),
  rendersDir: resolve(dataDir, 'renders'),
  cacheDir: resolve(dataDir, 'cache'),
  framesDir: resolve(dataDir, 'frames'),
  dbFile: resolve(dataDir, 'luma.db'),
  keyFile: resolve(dataDir, '.secret-key'),
  motionDir: resolve(process.env.MOTION_DIR ?? resolve(root, 'packages/motion/dist')),
  webDir: resolve(process.env.WEB_DIR ?? resolve(root, 'apps/web/dist')),
  migrationsDir: resolve(root, 'apps/server/drizzle'),
  secretKey: process.env.LUMA_SECRET_KEY,
  chromiumPath: process.env.CHROMIUM_PATH,
  elevenLabsUrl: process.env.ELEVENLABS_BASE_URL ?? 'https://api.elevenlabs.io',
  /** Commands started by the agent or the terminal are killed after this many milliseconds by default. */
  commandTimeoutMs: 60_000,
  maxAttachments: 20,
};

for (const dir of [config.dataDir, config.projectsDir, config.rendersDir, config.cacheDir, config.framesDir]) {
  mkdirSync(dir, { recursive: true });
}
