import { config } from '../config.js';
import { badRequest } from '../lib/errors.js';
import type { Word } from '@luma/motion/types';

export interface Voice {
  id: string;
  name: string;
  category: string;
  description: string;
  previewUrl: string | null;
}

export interface Quota {
  used: number;
  limit: number;
  remaining: number;
  resetsAt: number | null;
}

async function call(apiKey: string, path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${config.elevenLabsUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(120_000),
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json', ...init.headers },
    });
  } catch (e) {
    throw badRequest(`Could not reach ElevenLabs: ${e instanceof Error ? e.message : e}`);
  }
  return res;
}

async function failure(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { detail?: { message?: string } | string } | null;
  const detail = typeof body?.detail === 'string' ? body.detail : body?.detail?.message;
  if (res.status === 401) return badRequest(`ElevenLabs rejected this API key. ${detail ?? ''}`.trim());
  return badRequest(`ElevenLabs answered ${res.status}. ${detail ?? ''}`.trim());
}

export async function listVoices(apiKey: string): Promise<Voice[]> {
  const res = await call(apiKey, '/v1/voices');
  if (!res.ok) throw await failure(res);
  const json = (await res.json()) as {
    voices: Array<{ voice_id: string; name: string; category?: string; description?: string; preview_url?: string }>;
  };
  return json.voices.map((v) => ({
    id: v.voice_id,
    name: v.name,
    category: v.category ?? 'premade',
    description: v.description ?? '',
    previewUrl: v.preview_url ?? null,
  }));
}

/** Remaining characters, or `null` when the key is not allowed to read its subscription. */
export async function getQuota(apiKey: string): Promise<Quota | null> {
  const res = await call(apiKey, '/v1/user/subscription');
  if (!res.ok) return null;
  const json = (await res.json()) as { character_count: number; character_limit: number; next_character_count_reset_unix?: number };
  return {
    used: json.character_count,
    limit: json.character_limit,
    remaining: Math.max(0, json.character_limit - json.character_count),
    resetsAt: json.next_character_count_reset_unix ? json.next_character_count_reset_unix * 1000 : null,
  };
}

export interface Speech {
  audio: Buffer;
  words: Word[];
}

interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/** Group ElevenLabs' per-character timings into words. */
export function wordsFromAlignment(a: Alignment): Word[] {
  const words: Word[] = [];
  let current: Word | null = null;
  a.characters.forEach((char, i) => {
    const start = a.character_start_times_seconds[i]!;
    const end = a.character_end_times_seconds[i]!;
    if (/\s/.test(char)) {
      current = null;
      return;
    }
    if (!current) {
      current = { text: '', start, end };
      words.push(current);
    }
    current.text += char;
    current.end = end;
  });
  return words;
}

export async function speak(apiKey: string, voiceId: string, text: string, model: string): Promise<Speech> {
  const res = await call(apiKey, `/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    body: JSON.stringify({ text, model_id: model }),
  });
  if (!res.ok) throw await failure(res);
  const json = (await res.json()) as { audio_base64: string; alignment?: Alignment; normalized_alignment?: Alignment };
  const alignment = json.alignment ?? json.normalized_alignment;
  if (!alignment) throw badRequest('ElevenLabs returned audio without word timings.');
  return { audio: Buffer.from(json.audio_base64, 'base64'), words: wordsFromAlignment(alignment) };
}
