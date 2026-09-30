import { z } from 'zod';
import type { Manifest, VideoConfig } from '@luma/motion/types';
import { badRequest } from '../lib/errors.js';
import type { ProjectSource } from './source.js';

const videoSchema = z.object({
  width: z.number().int().min(16).max(7680),
  height: z.number().int().min(16).max(4320),
  fps: z.number().min(1).max(120),
  duration: z.number().positive().max(3600),
  bpm: z.number().min(20).max(300).default(100),
  background: z.string().optional(),
});

export async function readVideoConfig(source: ProjectSource): Promise<VideoConfig> {
  let raw: unknown;
  try {
    raw = JSON.parse((await source.read('video.json')).toString('utf8'));
  } catch (e) {
    throw badRequest(e instanceof SyntaxError ? `video.json is not valid JSON: ${e.message}` : 'video.json is missing.');
  }
  const parsed = videoSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw badRequest(`video.json: ${issue.path.join('.')} ${issue.message}`);
  }
  return parsed.data;
}

/** What the player needs to load a project: settings, scenes (with content hashes), the score and the voice lines. */
export async function buildManifest(source: ProjectSource): Promise<Manifest> {
  const [video, files] = await Promise.all([readVideoConfig(source), source.list()]);
  return {
    video,
    scenes: files.filter((f) => /^scenes\/[^/]+\.js$/.test(f)).sort(),
    audio: files.includes('audio.js') ? 'audio.js' : null,
    voice: files.filter((f) => /^audio\/voice\/[^/]+\.json$/.test(f)).sort(),
  };
}
