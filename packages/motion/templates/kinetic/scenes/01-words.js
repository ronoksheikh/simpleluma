// Kinetic typography with GSAP: a paused timeline, seeked to t in draw().
import gsap from 'gsap';
import { text } from 'luma';

export const start = 0;
export const duration = 5;

const words = ['Make', 'it', 'move.'];
const state = words.map(() => ({ y: 120, alpha: 0, skew: 8 }));
const bar = { w: 0 };
const exit = { y: 0, alpha: 1 };

const tl = gsap.timeline({ paused: true });
state.forEach((w, i) => tl.to(w, { y: 0, alpha: 1, skew: 0, duration: 0.7, ease: 'expo.out' }, 0.25 + i * 0.22));
tl.to(bar, { w: 1, duration: 0.9, ease: 'power4.inOut' }, 1.2);
tl.to(exit, { y: -60, alpha: 0, duration: 0.6, ease: 'power3.in' }, 4.3);

export function draw(ctx, t, f) {
  tl.seek(t, false);
  const x = 120;
  let y = 430;
  ctx.globalAlpha = exit.alpha;
  ctx.translate(0, exit.y);
  state.forEach((w, i) => {
    ctx.save();
    ctx.globalAlpha = exit.alpha * w.alpha;
    ctx.translate(x, y + w.y);
    ctx.transform(1, 0, -w.skew / 100, 1, 0, 0);
    text(ctx, words[i], 0, 0, { size: 168, weight: 700, color: i === 2 ? '#2970EC' : '#16181D', tracking: -6, baseline: 'alphabetic' });
    ctx.restore();
    y += 170;
  });
  ctx.fillStyle = '#5DAEFF';
  ctx.fillRect(x, 820, 840 * bar.w, 14);
}
