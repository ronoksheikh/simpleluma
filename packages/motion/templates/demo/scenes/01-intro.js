import { clamp, ease, linearGradient, map, text } from 'luma';
import { colors, mark } from '../lib/brand.js';

export const start = 0;
export const duration = 5;

export function draw(ctx, t, f) {
  const { width: w, height: h } = f;
  const fade = map(t, duration - 0.6, duration, 1, 0);

  const glow = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.6);
  glow.addColorStop(0, 'rgba(41, 112, 236, 0.35)');
  glow.addColorStop(1, 'rgba(41, 112, 236, 0)');
  ctx.fillStyle = glow;
  ctx.globalAlpha = map(t, 0, 1.5, 0, 1) * fade;
  ctx.fillRect(0, 0, w, h);

  const pop = ease.outBack(clamp(t / 0.9));
  ctx.globalAlpha = clamp(t / 0.3) * fade;
  mark(ctx, w / 2, h / 2 - 70, 220 * pop, map(t, 0.3, 1.5, 0, 1, ease.inOutCubic));

  const rise = map(t, 1.2, 2.0, 0, 1, ease.outCubic);
  ctx.globalAlpha = rise * fade;
  text(ctx, 'Luma Studio', w / 2, h / 2 + 150 + (1 - rise) * 30, { size: 96, weight: 500, align: 'center', baseline: 'middle', tracking: -1.5 });

  const sub = map(t, 2.0, 2.8, 0, 1, ease.outCubic);
  ctx.globalAlpha = sub * fade;
  text(ctx, 'Motion graphics, written in code', w / 2, h / 2 + 240, { size: 34, weight: 400, align: 'center', baseline: 'middle', color: colors.sky, tracking: 1 });

  ctx.globalAlpha = fade;
  const bar = map(t, 2.4, 3.6, 0, 1, ease.inOutCubic);
  ctx.fillStyle = linearGradient(ctx, w / 2 - 160, 0, w / 2 + 160, 0, [[0, colors.sky], [1, colors.blue]]);
  ctx.fillRect(w / 2 - 160 * bar, h / 2 + 290, 320 * bar, 4);
}
