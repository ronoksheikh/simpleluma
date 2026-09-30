import type { SceneTiming } from '@luma/motion/types';

export interface Chunk {
  /** First frame (inclusive) and last frame (exclusive). */
  from: number;
  to: number;
  /** Non-overlay scenes that draw during this chunk. */
  scenes: SceneTiming[];
}

const MIN_CHUNK_SECONDS = 2;
const MAX_CHUNK_SECONDS = 10;

const frameAt = (seconds: number, fps: number): number => Math.ceil(seconds * fps - 1e-6);

/**
 * Cut the video into chunks at scene boundaries, so a scene that did not change keeps its cached chunk.
 * Very short pieces (a crossfade) join a neighbour; very long pieces are split evenly so they can render in parallel.
 */
export function planChunks(timeline: SceneTiming[], fps: number, totalFrames: number): Chunk[] {
  const scenes = timeline.filter((s) => !s.overlay);
  const cuts = new Set<number>([0, totalFrames]);
  for (const s of scenes) {
    for (const t of [s.start, s.start + s.duration]) {
      const frame = frameAt(t, fps);
      if (frame > 0 && frame < totalFrames) cuts.add(frame);
    }
  }
  const points = [...cuts].sort((a, b) => a - b);

  const minFrames = Math.round(MIN_CHUNK_SECONDS * fps);
  const maxFrames = Math.round(MAX_CHUNK_SECONDS * fps);
  const spans: Array<[number, number]> = [];
  let from = 0;
  for (const to of points.slice(1)) {
    if (to - from < minFrames && to !== totalFrames) continue;
    spans.push([from, to]);
    from = to;
  }
  const tail = spans[spans.length - 1]!;
  const before = spans[spans.length - 2];
  if (before && tail[1] - tail[0] < minFrames) {
    before[1] = tail[1];
    spans.pop();
  }

  return spans.flatMap(([a, b]) => {
    const parts = Math.max(1, Math.ceil((b - a) / maxFrames));
    return Array.from({ length: parts }, (_, p) => {
      const from = a + Math.round(((b - a) * p) / parts);
      const to = a + Math.round(((b - a) * (p + 1)) / parts);
      return {
        from,
        to,
        scenes: scenes.filter((s) => frameAt(s.start, fps) < to && frameAt(s.start + s.duration, fps) > from),
      };
    });
  });
}
