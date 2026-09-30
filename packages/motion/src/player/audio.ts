import type { VoiceTrack } from '../types.js';
import type { Engine } from './engine.js';

type Score = { schedule?: (ac: BaseAudioContext, startTime: number, out: AudioNode) => void | Promise<void> };

const DUCK_DEPTH = 0.22;
const DUCK_MERGE_GAP = 0.8;

/** Merge voice clips into [start, end] ranges during which music should be ducked. */
function duckRanges(voice: VoiceTrack): Array<[number, number]> {
  const spans = voice.clips.map((c): [number, number] => [c.at, c.at + c.duration]).sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span[0] - last[1] < DUCK_MERGE_GAP) last[1] = Math.max(last[1], span[1]);
    else merged.push([...span]);
  }
  return merged;
}

/**
 * Builds the soundtrack: the project's `audio.js` score on a music bus that ducks under the voice lines,
 * plus the voice clips themselves. Works on a live AudioContext and on an OfflineAudioContext.
 */
export class Soundtrack {
  private score: Score | null = null;
  private voiceData = new Map<string, ArrayBuffer>();
  private buffers = new Map<string, AudioBuffer>();

  constructor(private readonly engine: Engine) {}

  async load(): Promise<void> {
    const { base, manifest, voice } = this.engine;
    this.score = null;
    this.voiceData.clear();
    if (manifest.audio) this.score = await import(/* @vite-ignore */ `${base}/${manifest.audio}`);
    await Promise.all(
      voice.clips.map(async (clip) => {
        const res = await fetch(`${base}/audio/voice/${clip.file}`);
        if (!res.ok) throw new Error(`Voice file ${clip.file} could not be loaded (${res.status}).`);
        this.voiceData.set(clip.name, await res.arrayBuffer());
      }),
    );
  }

  get isEmpty(): boolean {
    return !this.score?.schedule && this.engine.voice.clips.length === 0;
  }

  /** Decode the voice clips for `ac`. Call before `schedule` so nothing is decoded while the clock runs. */
  async prepare(ac: BaseAudioContext): Promise<void> {
    const decoded = await Promise.all(
      [...this.voiceData].map(async ([name, data]) => [name, await ac.decodeAudioData(data.slice(0))] as const),
    );
    this.buffers = new Map(decoded);
  }

  /**
   * Schedule everything. `origin` is the context time that corresponds to video time 0
   * (negative when playback starts part-way through the video).
   */
  async schedule(ac: BaseAudioContext, origin: number, master: AudioNode): Promise<void> {
    const music = ac.createGain();
    music.connect(master);
    const now = ac.currentTime;
    const at = (t: number): number => Math.max(0, origin + t);

    music.gain.setValueAtTime(1, 0);
    for (const [a, b] of duckRanges(this.engine.voice)) {
      music.gain.setValueAtTime(1, at(a - 0.25));
      music.gain.linearRampToValueAtTime(DUCK_DEPTH, at(a));
      music.gain.setValueAtTime(DUCK_DEPTH, at(b));
      music.gain.linearRampToValueAtTime(1, at(b + 0.5));
    }

    for (const clip of this.engine.voice.clips) {
      const buffer = this.buffers.get(clip.name);
      if (!buffer) continue;
      const src = ac.createBufferSource();
      src.buffer = buffer;
      src.connect(master);
      const when = origin + clip.at;
      if (when + buffer.duration <= now) continue;
      if (when >= now) src.start(when);
      else src.start(now, now - when);
    }

    await this.score?.schedule?.(ac, origin, music);
  }
}

/** 16-bit PCM WAV, base64-encoded for transfer to the renderer process. */
export function wavBase64(buffer: AudioBuffer): string {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytes = new Uint8Array(44 + frames * channels * 2);
  const view = new DataView(bytes.buffer);
  const writeText = (offset: number, s: string): void => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  writeText(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  writeText(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, frames * channels * 2, true);
  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (const channel of data) {
      const s = Math.max(-1, Math.min(1, channel[i]!));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
