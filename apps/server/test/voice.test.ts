import assert from 'node:assert/strict';
import { test } from 'node:test';
import { wordsFromAlignment } from '../src/voice/elevenlabs.js';

test('groups per-character timings into words', () => {
  const text = 'Hi there';
  const characters = [...text];
  const words = wordsFromAlignment({
    characters,
    character_start_times_seconds: characters.map((_, i) => i * 0.1),
    character_end_times_seconds: characters.map((_, i) => (i + 1) * 0.1),
  });
  assert.deepEqual(words.map((w) => w.text), ['Hi', 'there']);
  assert.equal(words[0]!.start, 0);
  assert.ok(Math.abs(words[0]!.end - 0.2) < 1e-9);
  assert.ok(Math.abs(words[1]!.start - 0.3) < 1e-9);
  assert.ok(Math.abs(words[1]!.end - 0.8) < 1e-9);
});
