import type { Frame } from './types.js';
import { clamp } from './easing.js';

export interface TextStyle {
  size?: number;
  weight?: number;
  family?: string;
  color?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  /** Letter spacing in px. */
  tracking?: number;
  alpha?: number;
}

const DEFAULT_FAMILY = '"Inter Variable", Inter, sans-serif';

export function setFont(ctx: CanvasRenderingContext2D, style: TextStyle = {}): void {
  ctx.font = `${style.weight ?? 500} ${style.size ?? 48}px ${style.family ?? DEFAULT_FAMILY}`;
  ctx.textAlign = style.align ?? 'left';
  ctx.textBaseline = style.baseline ?? 'alphabetic';
  ctx.letterSpacing = `${style.tracking ?? 0}px`;
}

/** Draw a single line of text. Restores the context afterwards. */
export function text(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, style: TextStyle = {}): void {
  ctx.save();
  setFont(ctx, style);
  ctx.fillStyle = style.color ?? '#ffffff';
  ctx.globalAlpha *= style.alpha ?? 1;
  ctx.fillText(str, x, y);
  ctx.restore();
}

export function measure(ctx: CanvasRenderingContext2D, str: string, style: TextStyle = {}): number {
  ctx.save();
  setFont(ctx, { ...style, align: 'left' });
  const width = ctx.measureText(str).width;
  ctx.restore();
  return width;
}

/** Break `str` into lines no wider than `maxWidth`. */
export function wrap(ctx: CanvasRenderingContext2D, str: string, maxWidth: number, style: TextStyle = {}): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of str.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measure(ctx, candidate, style) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export function linearGradient(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, x1: number, y1: number,
  stops: Array<[number, string]>,
): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [at, color] of stops) g.addColorStop(at, color);
  return g;
}

export interface CaptionStyle extends TextStyle {
  /** Centre of the caption block. */
  x: number;
  y: number;
  maxWidth: number;
  lineHeight?: number;
  /** Colour of the word being spoken. */
  highlight?: string;
  /** Words shown per caption page. */
  pageWords?: number;
  /** Opacity of words not spoken yet. */
  upcomingAlpha?: number;
}

interface PlacedWord {
  text: string;
  index: number;
  width: number;
}

/** Word-by-word captions synced to the voice track: spoken words light up as they are said. */
export function captions(ctx: CanvasRenderingContext2D, f: Frame, style: CaptionStyle): void {
  const { words } = f.voice;
  const current = words.findIndex((w) => f.time >= w.start && f.time < w.end + 0.15);
  if (current < 0) return;
  const clip = words[current]!.clip;
  const clipWords = words.map((w, index) => ({ w, index })).filter(({ w }) => w.clip === clip);
  const pageWords = style.pageWords ?? 8;
  const position = clipWords.findIndex(({ index }) => index === current);
  const page = clipWords.slice(Math.floor(position / pageWords) * pageWords).slice(0, pageWords);

  const textStyle: TextStyle = { size: style.size ?? 48, weight: style.weight ?? 600, family: style.family, tracking: style.tracking };
  const spaceWidth = measure(ctx, ' ', textStyle);
  const rows: PlacedWord[][] = [[]];
  let rowWidth = 0;
  for (const { w, index } of page) {
    const width = measure(ctx, w.text, textStyle);
    if (rows[rows.length - 1]!.length && rowWidth + spaceWidth + width > style.maxWidth) {
      rows.push([]);
      rowWidth = 0;
    }
    rows[rows.length - 1]!.push({ text: w.text, index, width });
    rowWidth += (rowWidth ? spaceWidth : 0) + width;
  }

  const lineHeight = style.lineHeight ?? (style.size ?? 48) * 1.3;
  const top = style.y - ((rows.length - 1) * lineHeight) / 2;
  const fadeIn = clamp((f.time - page[0]!.w.start) / 0.15 + 1);
  rows.forEach((row, r) => {
    let x = style.x - (row.reduce((sum, c) => sum + c.width, 0) + spaceWidth * (row.length - 1)) / 2;
    for (const c of row) {
      text(ctx, c.text, x, top + r * lineHeight, {
        ...textStyle,
        baseline: 'middle',
        color: c.index === current ? (style.highlight ?? '#5DAEFF') : (style.color ?? '#ffffff'),
        alpha: (c.index <= current ? 1 : (style.upcomingAlpha ?? 0.35)) * fadeIn,
      });
      x += c.width + spaceWidth;
    }
  });
}
