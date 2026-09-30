import { clamp, ease, map, text } from 'luma';
import { colors } from '../lib/brand.js';

export const start = 4.5;
export const duration = 5;

const lines = [
  { words: ['Describe', 'it.'], at: 0.3 },
  { words: ['Watch', 'it', 'move.'], at: 1.4 },
  { words: ['Render', 'it.'], at: 2.5 },
];

export function draw(ctx, t, f) {
  const h = f.height;
  const fade = map(t, 0, 0.5, 0, 1) * map(t, duration - 0.6, duration, 1, 0);
  lines.forEach((line, row) => {
    let x = 330;
    const y = h / 2 - 190 + row * 190;
    line.words.forEach((word, i) => {
      const k = ease.outCubic(clamp((t - line.at - i * 0.12) / 0.7));
      const accent = word === 'move.' || word === 'Render';
      ctx.save();
      ctx.font = '600 150px "Inter Variable"';
      const width = ctx.measureText(word + ' ').width;
      ctx.restore();
      text(ctx, word, x, y + (1 - k) * 90, {
        size: 150, weight: 600, baseline: 'middle', tracking: -3,
        color: accent ? colors.sky : '#ffffff', alpha: k * fade,
      });
      x += width;
    });
  });
  ctx.globalAlpha = fade;
  ctx.fillStyle = colors.blue;
  ctx.fillRect(330, h / 2 + 330, 560 * map(t, 3.2, 4.2, 0, 1, ease.inOutCubic), 6);
}
