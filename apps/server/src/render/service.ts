import { availableParallelism } from 'node:os';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import { randomToken } from '../lib/crypto.js';
import { notFound } from '../lib/errors.js';
import * as gitRepo from '../lib/git.js';
import { hub } from '../lib/hub.js';
import { buildManifest } from '../projects/manifest.js';
import { commitProject, projectDir } from '../projects/service.js';
import { commitTree } from '../projects/source.js';
import { RenderPage, formatErrors } from './browser.js';
import { assemble, encodeChunk } from './ffmpeg.js';
import { chunkKey, collectInputs } from './inputs.js';
import { planChunks } from './plan.js';
import { frameworkVersion } from './version.js';

export type RenderKind = 'preview' | 'final';
export type RenderRow = typeof schema.renders.$inferSelect;

const PROFILES = {
  preview: { height: 480, input: 'mjpeg', format: 'jpeg', preset: 'veryfast', crf: 27 },
  final: { height: 1080, input: 'png', format: 'png', preset: 'medium', crf: 18 },
} as const;

const MAX_WORKERS = 4;

const eta = new Map<string, number | null>();
const running = new Map<string, Promise<RenderRow>>();
let queue: Promise<unknown> = Promise.resolve();

export const renderFile = (row: Pick<RenderRow, 'projectId' | 'id'>): string => resolve(config.rendersDir, row.projectId, `${row.id}.mp4`);

export function view(row: RenderRow) {
  return { ...row, etaSeconds: eta.get(row.id) ?? null };
}

export function listRenders(projectId: string) {
  return db.select().from(schema.renders).where(eq(schema.renders.projectId, projectId)).orderBy(desc(schema.renders.createdAt)).all().map(view);
}

export function getRender(projectId: string, id: string): RenderRow {
  const row = db.select().from(schema.renders).where(and(eq(schema.renders.id, id), eq(schema.renders.projectId, projectId))).get();
  if (!row) throw notFound('Render not found');
  return row;
}

export function getRenderById(id: string): RenderRow | undefined {
  return db.select().from(schema.renders).where(eq(schema.renders.id, id)).get();
}

/** Renders that were running when the server stopped can never finish. */
export function recoverInterruptedRenders(): void {
  db.update(schema.renders)
    .set({ status: 'failed', error: 'The server restarted while this render was running.', finishedAt: Date.now() })
    .where(inArray(schema.renders.status, ['queued', 'rendering']))
    .run();
}

/** Commit the current state of the project and queue a render of that commit. Returns at once. */
export async function startRender(projectId: string, kind: RenderKind): Promise<RenderRow> {
  const dir = projectDir(projectId);
  await commitProject(projectId, 'Save changes before rendering');
  const sha = (await gitRepo.head(dir))!;
  const row: RenderRow = {
    id: randomToken(9), projectId, kind, status: 'queued', commit: sha, height: PROFILES[kind].height,
    framesDone: 0, framesTotal: 0, chunksTotal: 0, chunksCached: 0, progress: 0, error: null, sizeBytes: null,
    createdAt: Date.now(), finishedAt: null,
  };
  db.insert(schema.renders).values(row).run();
  hub.publish(projectId, { type: 'render.progress', render: view(row) });
  const done = queue.then(() => execute(row));
  queue = done;
  running.set(row.id, done);
  void done.finally(() => running.delete(row.id));
  return row;
}

/** Wait until a render finishes (used by the agent). */
export async function waitForRender(id: string): Promise<RenderRow> {
  return (await running.get(id)) ?? getRenderById(id)!;
}

function update(row: RenderRow, patch: Partial<RenderRow>): RenderRow {
  Object.assign(row, patch);
  db.update(schema.renders).set(patch).where(eq(schema.renders.id, row.id)).run();
  hub.publish(row.projectId, { type: 'render.progress', render: view(row) });
  return row;
}

async function execute(row: RenderRow): Promise<RenderRow> {
  const pages: RenderPage[] = [];
  try {
    update(row, { status: 'rendering' });
    await runRender(row, pages);
    const size = (await stat(renderFile(row))).size;
    eta.delete(row.id);
    return update(row, { status: 'done', progress: 1, framesDone: row.framesTotal, sizeBytes: size, finishedAt: Date.now() });
  } catch (e) {
    eta.delete(row.id);
    return update(row, { status: 'failed', error: e instanceof Error ? e.message : String(e), finishedAt: Date.now() });
  } finally {
    await Promise.all(pages.map((p) => p.close()));
  }
}

async function runRender(row: RenderRow, pages: RenderPage[]): Promise<void> {
  const profile = PROFILES[row.kind];
  const source = commitTree(projectDir(row.projectId), row.commit);
  const manifest = await buildManifest(source);
  const { fps } = manifest.video;

  const first = await RenderPage.open(row.projectId, row.commit);
  pages.push(first);
  const errors = await first.errors();
  if (errors.length) throw new Error(`The video has errors:\n${formatErrors(errors)}`);
  const timeline = await first.timeline();
  const { frames } = await first.info();

  const inputs = await collectInputs(source, manifest.video, manifest.scenes, manifest.voice, manifest.audio, frameworkVersion);
  const overlays = timeline.filter((s) => s.overlay);
  const chunkDir = resolve(config.cacheDir, row.projectId);
  await mkdir(chunkDir, { recursive: true });
  await mkdir(resolve(config.rendersDir, row.projectId), { recursive: true });

  const chunks = planChunks(timeline, fps, frames).map((chunk) => {
    const key = chunkKey(inputs, chunk, overlays, profile.height, profile.format);
    return { ...chunk, file: resolve(chunkDir, `${key}.mp4`) };
  });
  const todo = chunks.filter((c) => !existsSync(c.file));
  const cachedFrames = chunks.filter((c) => existsSync(c.file)).reduce((n, c) => n + (c.to - c.from), 0);
  update(row, { framesTotal: frames, framesDone: cachedFrames, chunksTotal: chunks.length, chunksCached: chunks.length - todo.length, progress: cachedFrames / frames });

  // Soundtrack: rendered once per set of audio inputs.
  let wav: string | null = null;
  if (inputs.audioHash) {
    wav = resolve(chunkDir, `audio-${inputs.audioHash}.wav`);
    if (!existsSync(wav)) {
      const data = await first.audioWav();
      if (data) await writeFile(wav, data);
      else wav = null;
    }
  }

  // Frames: a pool of browser pages, one chunk at a time each.
  let framesDone = cachedFrames;
  const startedAt = Date.now();
  let lastReport = 0;
  const report = (): void => {
    const now = Date.now();
    if (now - lastReport < 250) return;
    lastReport = now;
    const rate = (framesDone - cachedFrames) / Math.max(0.001, (now - startedAt) / 1000);
    eta.set(row.id, rate > 0 ? Math.round((frames - framesDone) / rate) : null);
    update(row, { framesDone, progress: framesDone / frames });
  };

  const queueOfChunks = [...todo];
  const workerCount = Math.max(1, Math.min(availableParallelism(), MAX_WORKERS, todo.length));
  await Promise.all(
    Array.from({ length: workerCount }, async (_, i) => {
      const page = i === 0 ? first : await RenderPage.open(row.projectId, row.commit);
      if (i > 0) pages.push(page);
      for (let chunk = queueOfChunks.shift(); chunk; chunk = queueOfChunks.shift()) {
        const temp = `${chunk.file}.${row.id}.tmp.mp4`;
        const encoder = encodeChunk(temp, { fps, input: profile.input, preset: profile.preset, crf: profile.crf });
        try {
          for (let f = chunk.from; f < chunk.to; f++) {
            await encoder.write(await page.frame(f, profile.height, profile.format));
            framesDone++;
            report();
          }
          await encoder.finish();
        } catch (e) {
          encoder.abort();
          await rm(temp, { force: true });
          queueOfChunks.length = 0;
          throw e;
        }
        await rename(temp, chunk.file);
      }
    }),
  );

  await assemble(chunks.map((c) => c.file), wav, renderFile(row), resolve(chunkDir, `${row.id}.txt`));
  await rm(resolve(chunkDir, `${row.id}.txt`), { force: true });
  await pruneCache(chunkDir, chunks.map((c) => c.file));
}

/** Keep the cache from growing without bound: mark the chunks just used and drop the ones nobody used for a week. */
async function pruneCache(dir: string, used: string[]): Promise<void> {
  const now = new Date();
  await Promise.all(used.map((file) => utimes(file, now, now)));
  const keep = new Set(used);
  for (const name of await readdir(dir)) {
    const file = resolve(dir, name);
    if (!keep.has(file) && now.getTime() - (await stat(file)).mtimeMs > 7 * 24 * 3600 * 1000) await rm(file, { force: true });
  }
}
