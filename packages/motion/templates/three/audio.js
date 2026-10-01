import { sound } from 'luma';

export function schedule(ac, startTime, out) {
  const notes = [57, 64, 69, 72];
  notes.forEach((n, i) => sound.tone(ac, out, { time: startTime + 0.2 + i * 0.6, freq: sound.midiToHz(n), duration: 2.4, type: 'sine', gain: 0.06, attack: 0.4, release: 1.6 }));
  sound.kick(ac, out, { time: startTime + 2.2, gain: 0.35 });
}
