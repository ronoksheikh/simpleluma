import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SceneTiming, VideoConfig } from '@luma/motion/types';
import { chunkKey, collectInputs } from '../src/render/inputs.js';
import { planChunks } from '../src/render/plan.js';
import type { ProjectSource } from '../src/projects/source.js';

const video: VideoConfig = { width: 1920, height: 1080, fps: 30, duration: 15, bpm: 100 };
const timeline: SceneTiming[] = [
  { path: 'scenes/a.js', start: 0, duration: 5, overlay: false },
  { path: 'scenes/b.js', start: 5, duration: 5, overlay: false },
  { path: 'scenes/c.js', start: 10, duration: 5, overlay: false },
];

function memory(files: Record<string, string>): ProjectSource {
  return {
    list: async () => Object.keys(files),
    read: async (path) => {
      if (!(path in files)) throw new Error(`missing ${path}`);
      return Buffer.from(files[path]!);
    },
  };
}

async function keys(files: Record<string, string>): Promise<string[]> {
  const inputs = await collectInputs(memory(files), video, timeline.map((t) => t.path), [], null, 'v1');
  return planChunks(timeline, video.fps, 450).map((chunk) => chunkKey(inputs, chunk, [], 1080, 'png'));
}

const base = {
  'scenes/a.js': 'export const a = 1;',
  'scenes/b.js': "import { helper } from '../lib/helper.js'; export const b = helper;",
  'scenes/c.js': 'export const c = 1;',
  'lib/helper.js': 'export const helper = 1;',
};

test('editing one scene changes only its chunk key', async () => {
  const before = await keys(base);
  const after = await keys({ ...base, 'scenes/b.js': "import { helper } from '../lib/helper.js'; export const b = helper + 1;" });
  assert.equal(before[0], after[0]);
  assert.notEqual(before[1], after[1]);
  assert.equal(before[2], after[2]);
});

test('editing a helper re-renders only the scenes that import it', async () => {
  const before = await keys(base);
  const after = await keys({ ...base, 'lib/helper.js': 'export const helper = 2;' });
  assert.equal(before[0], after[0]);
  assert.notEqual(before[1], after[1]);
  assert.equal(before[2], after[2]);
});

test('changing an asset invalidates every chunk', async () => {
  const before = await keys({ ...base, 'assets/logo.svg': '<svg/>' });
  const after = await keys({ ...base, 'assets/logo.svg': '<svg id="x"/>' });
  before.forEach((key, i) => assert.notEqual(key, after[i]));
});
