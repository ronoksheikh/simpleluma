import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { VoiceClip } from '@luma/motion/types';
import { badRequest } from '../lib/errors.js';
import { projectDir, writeProjectFile } from '../projects/service.js';
import { speak } from './elevenlabs.js';

const exec = promisify(execFile);
export const DEFAULT_VOICE_MODEL = 'eleven_multilingual_v2';

async function audioDuration(file: string, fallback: number): Promise<number> {
  try {
    const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
    const seconds = Number(stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : fallback;
  } catch {
    return fallback;
  }
}

export interface GeneratedVoice {
  clip: VoiceClip;
  path: string;
}

/** Generate a line of speech with word timings and store it as `audio/voice/<name>.mp3` + `.json`. */
export async function generateVoice(
  projectId: string,
  apiKey: string,
  o: { text: string; voiceId: string; name: string; at: number; model?: string },
): Promise<GeneratedVoice> {
  const name = o.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!name) throw badRequest('Give the voice line a name, for example "intro".');
  const speech = await speak(apiKey, o.voiceId, o.text, o.model ?? DEFAULT_VOICE_MODEL);

  const audioPath = `audio/voice/${name}.mp3`;
  await writeProjectFile(projectId, audioPath, speech.audio);
  const lastEnd = speech.words.at(-1)?.end ?? 0;
  const duration = await audioDuration(resolve(projectDir(projectId), audioPath), lastEnd);
  const clip: VoiceClip = { text: o.text, voiceId: o.voiceId, file: `${name}.mp3`, at: o.at, duration: Math.round(duration * 1000) / 1000, words: speech.words };
  await writeProjectFile(projectId, `audio/voice/${name}.json`, `${JSON.stringify(clip, null, 2)}\n`);
  return { clip, path: `audio/voice/${name}.json` };
}

