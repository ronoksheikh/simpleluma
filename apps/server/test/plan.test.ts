import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SceneTiming } from '@luma/motion/types';
import { planChunks } from '../src/render/plan.js';

const scene = (path: string, start: number, duration: number, overlay = false): SceneTiming => ({ path, start, duration, overlay });
const FPS = 30;

test('one chunk per scene when scenes follow each other', () => {
  const chunks = planChunks([scene('a', 0, 4), scene('b', 4, 5), scene('c', 9, 3)], FPS, 12 * FPS);
  assert.deepEqual(chunks.map((c) => [c.from, c.to]), [[0, 120], [120, 270], [270, 360]]);
  assert.deepEqual(chunks.map((c) => c.scenes.map((s) => s.path)), [['a'], ['b'], ['c']]);
});

test('a short crossfade joins the chunk that follows it', () => {
  const chunks = planChunks([scene('a', 0, 5), scene('b', 4.5, 5)], FPS, 9.5 * FPS);
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks[1]!.scenes.map((s) => s.path), ['a', 'b']);
});

test('long scenes are split evenly so they can render in parallel', () => {
  const chunks = planChunks([scene('a', 0, 25)], FPS, 25 * FPS);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0]!.from, 0);
  assert.equal(chunks.at(-1)!.to, 25 * FPS);
  for (const c of chunks) assert.ok(c.to - c.from <= 10 * FPS);
});

test('chunks always cover every frame exactly once', () => {
  const total = 24 * FPS;
  const chunks = planChunks([scene('a', 0, 5), scene('b', 4.5, 5), scene('c', 9, 5), scene('d', 13.5, 5.5), scene('e', 18.5, 5.5)], FPS, total);
  assert.equal(chunks[0]!.from, 0);
  assert.equal(chunks.at(-1)!.to, total);
  chunks.slice(1).forEach((c, i) => assert.equal(c.from, chunks[i]!.to));
});

test('overlay scenes never split the video', () => {
  const chunks = planChunks([scene('a', 0, 4), scene('captions', 0, 12, true), scene('b', 4, 8)], FPS, 12 * FPS);
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((c) => c.scenes.every((s) => !s.overlay)));
});

test('a video with no scenes is still one renderable chunk', () => {
  assert.deepEqual(planChunks([], FPS, 90).map((c) => [c.from, c.to]), [[0, 90]]);
});
