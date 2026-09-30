import { sound } from 'luma';

const { tone, kick, noise, midiToHz } = sound;
const beat = 60 / 96;

// A minor, F major, C major, G major: one chord per bar (4 beats).
const chords = [[57, 60, 64], [53, 57, 60], [48, 55, 64], [55, 59, 62]];

export function schedule(ac, startTime, out) {
  const end = 24;
  for (let bar = 0; bar * 4 * beat < end; bar++) {
    const time = startTime + bar * 4 * beat;
    const chord = chords[bar % chords.length];
    chord.forEach((note, i) => {
      tone(ac, out, { time, freq: midiToHz(note), duration: 4 * beat + 0.4, type: 'sawtooth', gain: 0.03, attack: 0.5, release: 0.7, cutoff: 1100, detune: i * 5 - 5 });
    });
    tone(ac, out, { time, freq: midiToHz(chord[0] - 24), duration: 4 * beat, type: 'sine', gain: 0.16, attack: 0.03, release: 0.4 });
    for (let step = 0; step < 8; step++) {
      const at = time + step * beat * 0.5;
      if (at - startTime < 4.5) continue;
      const note = chord[step % chord.length] + 12 * (1 + (step % 4 === 3 ? 1 : 0));
      tone(ac, out, { time: at, freq: midiToHz(note), duration: 0.35, type: 'triangle', gain: 0.05, attack: 0.005, release: 0.3 });
    }
  }
  for (let b = Math.ceil(4.5 / beat); b * beat < 19; b++) {
    kick(ac, out, { time: startTime + b * beat, gain: b % 4 === 0 ? 0.42 : 0.28 });
  }
  noise(ac, out, { time: startTime + 18.1, duration: 0.9, gain: 0.08, freq: 3000, q: 0.5, seed: 3 });
}
