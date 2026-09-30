import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { SceneTiming, VideoConfig, VoiceClip } from '@luma/motion/types';
import type { ProjectSource } from '../projects/source.js';
import type { Chunk } from './plan.js';

const sha1 = (data: Buffer | string): string => createHash('sha1').update(data).digest('hex');

const IMPORT = /(?:\bimport|\bexport)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Hash of a module and every project file it imports, so an edit to a shared helper re-renders the scenes that use it. */
async function moduleHash(source: ProjectSource, path: string, seen = new Set<string>()): Promise<string> {
  if (seen.has(path)) return '';
  seen.add(path);
  let code: string;
  try {
    code = (await source.read(path)).toString('utf8');
  } catch {
    return `missing:${path}`;
  }
  const parts = [sha1(code)];
  for (const match of code.matchAll(IMPORT)) {
    const specifier = match[1] ?? match[2] ?? match[3] ?? '';
    if (specifier.startsWith('.')) parts.push(await moduleHash(source, posix.join(posix.dirname(path), specifier), seen));
  }
  return sha1(parts.join('|'));
}

export interface RenderInputs {
  video: VideoConfig;
  /** Hash of everything that changes how a frame looks except the scenes: assets and the framework itself. */
  shared: string;
  sceneHash: Map<string, string>;
  clips: Array<VoiceClip & { name: string; hash: string }>;
  audioHash: string | null;
}

export async function collectInputs(source: ProjectSource, video: VideoConfig, scenePaths: string[], voicePaths: string[], audioPath: string | null, frameworkVersion: string): Promise<RenderInputs> {
  const files = await source.list();
  const assets = await Promise.all(files.filter((f) => f.startsWith('assets/')).sort().map(async (f) => `${f}:${sha1(await source.read(f))}`));
  const sceneHash = new Map(await Promise.all(scenePaths.map(async (p) => [p, await moduleHash(source, p)] as const)));
  const clips = await Promise.all(
    voicePaths.map(async (path) => {
      const raw = await source.read(path);
      return { ...(JSON.parse(raw.toString('utf8')) as VoiceClip), name: path, hash: sha1(raw) };
    }),
  );
  const audioFiles = await Promise.all(clips.map(async (c) => sha1(await source.read(`audio/voice/${c.file}`).catch(() => Buffer.alloc(0)))));
  const audioHash = audioPath || clips.length
    ? sha1(JSON.stringify([video.duration, audioPath ? await moduleHash(source, audioPath) : null, clips.map((c) => c.hash), audioFiles, frameworkVersion]))
    : null;
  return { video, shared: sha1(JSON.stringify([assets, frameworkVersion])), sceneHash, clips, audioHash };
}

/** Cache key of one chunk: its frames, the scenes drawn in it, the voice lines heard in it, and the shared inputs. */
export function chunkKey(inputs: RenderInputs, chunk: Chunk, overlays: SceneTiming[], height: number, format: string): string {
  const { video } = inputs;
  const from = chunk.from / video.fps;
  const to = chunk.to / video.fps;
  const scene = (s: SceneTiming): [string, string | undefined, number, number] => [s.path, inputs.sceneHash.get(s.path), s.start, s.duration];
  return sha1(
    JSON.stringify({
      frames: [chunk.from, chunk.to],
      render: [video.width, video.height, video.fps, video.bpm, video.background, height, format],
      scenes: chunk.scenes.map(scene),
      overlays: overlays.map(scene),
      voice: inputs.clips.filter((c) => c.at < to && c.at + c.duration > from).map((c) => c.hash),
      shared: inputs.shared,
    }),
  );
}
