export const clamp = (v: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, v));

export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/** Position of `t` between `a` and `b`, clamped to 0..1. */
export const progress = (t: number, a: number, b: number): number => (b === a ? 1 : clamp((t - a) / (b - a)));

/** Map `t` from [a, b] to [from, to], optionally shaped by an easing function. */
export function map(t: number, a: number, b: number, from = 0, to = 1, fn: Ease = linear): number {
  return lerp(from, to, fn(progress(t, a, b)));
}

export type Ease = (k: number) => number;

export const linear: Ease = (k) => k;
export const inQuad: Ease = (k) => k * k;
export const outQuad: Ease = (k) => 1 - (1 - k) * (1 - k);
export const inOutQuad: Ease = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
export const inCubic: Ease = (k) => k ** 3;
export const outCubic: Ease = (k) => 1 - (1 - k) ** 3;
export const inOutCubic: Ease = (k) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2);
export const outQuart: Ease = (k) => 1 - (1 - k) ** 4;
export const inOutQuart: Ease = (k) => (k < 0.5 ? 8 * k ** 4 : 1 - (-2 * k + 2) ** 4 / 2);
export const outExpo: Ease = (k) => (k >= 1 ? 1 : 1 - 2 ** (-10 * k));
export const inOutSine: Ease = (k) => -(Math.cos(Math.PI * k) - 1) / 2;
export const outBack: Ease = (k) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (k - 1) ** 3 + c1 * (k - 1) ** 2;
};
export const outElastic: Ease = (k) => {
  if (k <= 0) return 0;
  if (k >= 1) return 1;
  return 2 ** (-10 * k) * Math.sin(((k * 10 - 0.75) * (2 * Math.PI)) / 3) + 1;
};

export const ease = {
  linear, inQuad, outQuad, inOutQuad, inCubic, outCubic, inOutCubic, outQuart, inOutQuart, outExpo, inOutSine, outBack, outElastic,
};
