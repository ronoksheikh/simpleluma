import { clamp, ease, map, rng, text } from 'luma';
import { colors } from '../lib/brand.js';

export const start = 13.5;
export const duration = 5.5;

const random = rng(7);
const dots = Array.from({ length: 140 }, () => ({
  radius: random.range(140, 520),
  speed: random.range(0.15, 0.6) * (random() < 0.5 ? -1 : 1),
  phase: random.range(0, Math.PI * 2),
  size: random.range(2, 7),
  tilt: random.range(0.35, 0.6),
  hue: random(),
}));

export function draw(ctx, t, f) {
  const { width: w, height: h } = f;
  const fade = map(t, 0, 0.6, 0, 1) * map(t, duration - 0.6, duration, 1, 0);
  const cx = w / 2;
  const cy = h / 2 - 40;

  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, 240);
  core.addColorStop(0, colors.sky);
  core.addColorStop(0.45, colors.blue);
  core.addColorStop(1, 'rgba(21, 87, 209, 0)');
  ctx.globalAlpha = fade * ease.outCubic(clamp(t / 1.2));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, 240 * (1 + Math.sin(f.beat * Math.PI * 2) * 0.03), 0, Math.PI * 2);
  ctx.fill();

  for (const d of dots) {
    const angle = d.phase + f.time * d.speed;
    const x = cx + Math.cos(angle) * d.radius;
    const y = cy + Math.sin(angle) * d.radius * d.tilt;
    const behind = Math.sin(angle) < 0;
    ctx.globalAlpha = fade * (behind ? 0.35 : 0.95) * ease.outCubic(clamp((t - d.hue * 1.2) / 0.8));
    ctx.fillStyle = d.hue < 0.5 ? colors.sky : '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, d.size, 0, Math.PI * 2);
    ctx.fill();
  }

  const rise = ease.outCubic(clamp((t - 1) / 0.8));
  text(ctx, 'Every frame depends only on t', cx, h - 170 + (1 - rise) * 24, {
    size: 54, weight: 500, align: 'center', baseline: 'middle', tracking: -0.5, alpha: rise * fade,
  });
}
