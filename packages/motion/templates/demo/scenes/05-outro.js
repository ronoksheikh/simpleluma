import { clamp, ease, linearGradient, map, text } from 'luma';
import { colors, mark } from '../lib/brand.js';

export const start = 18.5;
export const duration = 5.5;

export function draw(ctx, t, f) {
  const { width: w, height: h } = f;
  ctx.globalAlpha = ease.inOutCubic(clamp(t / 1));
  ctx.fillStyle = linearGradient(ctx, 0, 0, w, h, [[0, colors.sky], [0.37, colors.blue], [0.72, colors.royal], [1, colors.deep]]);
  ctx.fillRect(0, 0, w, h);

  const pop = ease.outBack(clamp((t - 0.5) / 0.9));
  ctx.globalAlpha = clamp((t - 0.5) / 0.3) * map(t, duration - 0.5, duration, 1, 0);
  mark(ctx, w / 2, h / 2 - 90, 180 * pop);

  const rise = ease.outCubic(clamp((t - 1.2) / 0.8));
  ctx.globalAlpha = rise;
  text(ctx, 'Luma Studio', w / 2, h / 2 + 90 + (1 - rise) * 24, { size: 84, weight: 500, align: 'center', baseline: 'middle', tracking: -1.2 });
  text(ctx, 'Describe a video. Get an MP4.', w / 2, h / 2 + 175, { size: 36, weight: 400, align: 'center', baseline: 'middle', alpha: 0.85 });
}
