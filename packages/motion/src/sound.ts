/** Small Web Audio helpers for writing scores in `audio.js`. All times are in AudioContext seconds. */

export const midiToHz = (note: number): number => 440 * 2 ** ((note - 69) / 12);

export interface ToneOptions {
  time: number;
  freq: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  release?: number;
  detune?: number;
  /** Low-pass cutoff in Hz. */
  cutoff?: number;
}

/** When the player seeks mid-video, notes that already ended are skipped and running ones start now. */
function clampToNow(ac: BaseAudioContext, time: number, duration: number): { start: number; duration: number } | null {
  const end = time + duration;
  if (end <= ac.currentTime) return null;
  const start = Math.max(time, ac.currentTime);
  return { start, duration: end - start };
}

/** One enveloped oscillator note routed to `out`. */
export function tone(ac: BaseAudioContext, out: AudioNode, o: ToneOptions): void {
  const span = clampToNow(ac, o.time, o.duration);
  if (!span) return;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  const attack = o.attack ?? 0.01;
  const release = o.release ?? 0.1;
  const peak = o.gain ?? 0.2;
  osc.type = o.type ?? 'sine';
  osc.frequency.value = o.freq;
  osc.detune.value = o.detune ?? 0;
  amp.gain.setValueAtTime(0.0001, span.start);
  amp.gain.linearRampToValueAtTime(peak, span.start + attack);
  amp.gain.setValueAtTime(peak, span.start + Math.max(attack, span.duration - release));
  amp.gain.linearRampToValueAtTime(0.0001, span.start + span.duration);
  let tail: AudioNode = osc;
  if (o.cutoff) {
    const lowpass = ac.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = o.cutoff;
    osc.connect(lowpass);
    tail = lowpass;
  }
  tail.connect(amp).connect(out);
  osc.start(span.start);
  osc.stop(span.start + span.duration + 0.05);
}

/** A soft kick drum: a sine that drops in pitch. */
export function kick(ac: BaseAudioContext, out: AudioNode, o: { time: number; gain?: number }): void {
  const span = clampToNow(ac, o.time, 0.4);
  if (!span) return;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.frequency.setValueAtTime(150, span.start);
  osc.frequency.exponentialRampToValueAtTime(45, span.start + 0.12);
  amp.gain.setValueAtTime(o.gain ?? 0.5, span.start);
  amp.gain.exponentialRampToValueAtTime(0.0001, span.start + span.duration);
  osc.connect(amp).connect(out);
  osc.start(span.start);
  osc.stop(span.start + span.duration + 0.05);
}

export interface NoiseOptions {
  time: number;
  duration: number;
  gain?: number;
  /** Band-pass centre frequency in Hz. */
  freq?: number;
  q?: number;
  seed?: number;
}

/** A burst of filtered noise (hits, whooshes). The noise is seeded, so every render sounds the same. */
export function noise(ac: BaseAudioContext, out: AudioNode, o: NoiseOptions): void {
  const span = clampToNow(ac, o.time, o.duration);
  if (!span) return;
  const length = Math.max(1, Math.floor(ac.sampleRate * o.duration));
  const buffer = ac.createBuffer(1, length, ac.sampleRate);
  const data = buffer.getChannelData(0);
  let s = (o.seed ?? 1) >>> 0;
  for (let i = 0; i < length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    data[i] = (s / 4294967296) * 2 - 1;
  }
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = o.freq ?? 2000;
  filter.Q.value = o.q ?? 0.7;
  const amp = ac.createGain();
  amp.gain.setValueAtTime(o.gain ?? 0.2, span.start);
  amp.gain.exponentialRampToValueAtTime(0.0001, span.start + span.duration);
  src.connect(filter).connect(amp).connect(out);
  src.start(span.start);
}
