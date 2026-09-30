import { linearGradient, roundRect } from 'luma';

export const colors = {
  blue: '#2970EC',
  sky: '#5DAEFF',
  royal: '#1557D1',
  deep: '#07358F',
  offWhite: '#EFF5FF',
  night: '#071738',
};

/** The Luma mark: a gradient tile with a stroked "L" that can draw itself on (`drawn` 0..1). */
export function mark(ctx, cx, cy, size, drawn = 1) {
  const half = size / 2;
  ctx.save();
  roundRect(ctx, cx - half, cy - half, size, size, size * 0.28);
  ctx.fillStyle = linearGradient(ctx, cx - half, cy - half, cx + half, cy + half, [
    [0, colors.sky], [0.37, colors.blue], [0.72, colors.royal], [1, colors.deep],
  ]);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = size * 0.13;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const path = new Path2D();
  path.moveTo(cx - size * 0.17, cy - size * 0.25);
  path.lineTo(cx - size * 0.17, cy + size * 0.08);
  path.quadraticCurveTo(cx - size * 0.17, cy + size * 0.25, cx, cy + size * 0.25);
  path.lineTo(cx + size * 0.24, cy + size * 0.25);
  const length = size * 0.85;
  ctx.setLineDash([length * drawn, length]);
  ctx.stroke(path);
  ctx.restore();
}
