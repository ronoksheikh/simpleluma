import { clamp, ease, linearGradient, map, roundRect, text } from 'luma';
import { colors } from '../lib/brand.js';

export const start = 9;
export const duration = 5;

const bars = [
  { label: 'Plan', value: 0.42 },
  { label: 'Build', value: 0.68 },
  { label: 'Check', value: 0.55 },
  { label: 'Render', value: 0.92 },
  { label: 'Share', value: 0.78 },
];

export function draw(ctx, t, f) {
  const { width: w, height: h } = f;
  const fade = map(t, 0, 0.5, 0, 1) * map(t, duration - 0.6, duration, 1, 0);
  const cardW = 1240;
  const cardH = 640;
  const x0 = (w - cardW) / 2;
  const y0 = (h - cardH) / 2;
  const slide = ease.outCubic(clamp(t / 0.8));

  ctx.save();
  ctx.globalAlpha = fade;
  ctx.translate(0, (1 - slide) * 60);
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 24;
  roundRect(ctx, x0, y0, cardW, cardH, 40);
  ctx.fillStyle = 'rgba(239, 245, 255, 0.96)';
  ctx.fill();
  ctx.shadowColor = 'transparent';

  text(ctx, 'Every step, one frame at a time', x0 + 64, y0 + 88, { size: 40, weight: 600, color: colors.night, baseline: 'middle', tracking: -0.5 });
  const count = Math.round(87 * ease.outExpo(clamp((t - 0.6) / 2.4)));
  text(ctx, `${count}%`, x0 + cardW - 64, y0 + 88, { size: 64, weight: 600, color: colors.blue, align: 'right', baseline: 'middle', tracking: -1 });

  const chartTop = y0 + 160;
  const chartH = 360;
  const slot = (cardW - 128) / bars.length;
  bars.forEach((bar, i) => {
    const k = ease.outCubic(clamp((t - 0.5 - i * 0.14) / 1.1));
    const bw = slot * 0.55;
    const bx = x0 + 64 + slot * i + (slot - bw) / 2;
    const bh = chartH * bar.value * k;
    roundRect(ctx, bx, chartTop + chartH - bh, bw, bh, 16);
    ctx.fillStyle = linearGradient(ctx, 0, chartTop + chartH - bh, 0, chartTop + chartH, [[0, colors.sky], [1, colors.blue]]);
    ctx.fill();
    text(ctx, bar.label, bx + bw / 2, chartTop + chartH + 44, { size: 26, weight: 500, color: colors.night, align: 'center', baseline: 'middle', alpha: 0.7 });
  });
  ctx.restore();
}
