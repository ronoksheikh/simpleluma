import { basename } from 'node:path';
import type { Brand } from './brand.js';

/** Rule-based brand detection: pure functions over file contents. */
export interface Found {
  name?: string;
  colors: Brand['colors'];
  gradients: string[];
  fonts: Brand['fonts'];
  logos: Brand['logos'];
  rules: string[];
}

export const empty = (): Found => ({ colors: [], gradients: [], fonts: [], logos: [], rules: [] });

export const toHex6 = (c: string): string | null => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? m[1]!.split('').map((x) => x + x).join('') : m[1]!;
  return `#${h.toUpperCase()}`;
};

/** Near-white, near-black and greys are rarely brand colours when found in artwork. */
export function isNeutral(h: string): boolean {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  return Math.max(r, g, b) - Math.min(r, g, b) < 18;
}

export const LOGO_NAME = /logo|icon|mark|symbol|wordmark|emblem|lockup|monogram|favicon/i;

export function detectFromSvg(path: string, source: string): Found {
  const found = empty();
  const counts = new Map<string, number>();
  for (const m of source.matchAll(/(?:fill|stroke|stop-color|color)\s*[:=]\s*["']?\s*(#[0-9a-fA-F]{3,6})\b/g)) {
    const h = toHex6(m[1]!);
    if (h) counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  for (const [h] of [...counts].sort((a, b) => b[1] - a[1]).filter(([c]) => !isNeutral(c)).slice(0, 8)) {
    found.colors.push({ name: '', hex: h, role: 'detected', usage: `used in ${basename(path)}` });
  }
  for (const g of source.matchAll(/<linearGradient\b[\s\S]*?<\/linearGradient>/g)) {
    const stops = [...g[0].matchAll(/<stop\b[^>]*>/g)].map((s) => {
      const color = /stop-color\s*[:=]\s*["']?\s*(#[0-9a-fA-F]{3,6})/.exec(s[0])?.[1];
      const offset = /offset\s*=\s*["']?([\d.]+%?)/.exec(s[0])?.[1] ?? '0';
      const pct = offset.endsWith('%') ? offset : `${Math.round(Number(offset) * 100)}%`;
      return color ? `${toHex6(color)} ${pct}` : null;
    }).filter(Boolean);
    if (stops.length >= 2) found.gradients.push(`linear-gradient(135deg, ${stops.join(', ')})`);
  }
  for (const m of source.matchAll(/font-family\s*[:=]\s*["']?([^;"'>]+)/g)) {
    const family = m[1]!.split(',')[0]!.trim().replace(/^['"]|['"]$/g, '');
    if (family && !found.fonts.some((f) => f.family === family)) found.fonts.push({ family, role: `seen in ${basename(path)}` });
  }
  const title = /<title>([^<]{1,80})<\/title>/.exec(source)?.[1] ?? /aria-label="([^"]{1,80})"/.exec(source)?.[1];
  if (title) found.name = title.trim();
  if (LOGO_NAME.test(path) || source.length < 60_000) found.logos.push({ path, use: logoUse(path) });
  return found;
}

export function logoUse(path: string): string {
  const n = basename(path).toLowerCase();
  if (/white|reverse|negative|light/.test(n)) return 'on dark or coloured backgrounds';
  if (/dark|black|navy|night/.test(n)) return 'on light backgrounds';
  if (/icon|symbol|mark|favicon/.test(n)) return 'small placements, symbol only';
  return '';
}

/** Read colours, gradients, fonts and rules out of brand guidelines text (Markdown, plain text or a PDF's text). */
export function detectFromText(text: string): Found {
  const found = empty();
  const heading = /^#\s+(.+?)(?:\s+[—–-]\s+.*)?$/m.exec(text)?.[1];
  if (heading && heading.length < 60) found.name = heading.replace(/brand( guidelines| book| identity)?/i, '').trim() || heading;
  let section = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (/^#{1,6}\s/.test(line)) section = line.replace(/^#+\s*/, '').toLowerCase();
    for (const g of line.matchAll(/linear-gradient\([^)]*\)/g)) if (!found.gradients.includes(g[0])) found.gradients.push(g[0]);
    const hexes = [...line.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)];
    if (hexes.length === 1 && !line.includes('linear-gradient')) {
      const h = toHex6(hexes[0]![0])!;
      const cells = line.split('|').map((c) => c.replace(/[`*_]/g, '').trim()).filter(Boolean);
      const at = cells.findIndex((c) => c.includes(hexes[0]![0]));
      const name = (cells.length > 1 ? cells[at - 1] ?? '' : line.slice(0, hexes[0]!.index).replace(/[-•*:|`]/g, ' ')).trim().slice(0, 60);
      const usage = (cells.length > 1 ? cells.slice(at + 1).join(' · ') : line.slice(hexes[0]!.index! + hexes[0]![0].length).replace(/^[\s:—–|-]+/, '')).trim().slice(0, 200);
      found.colors.push({ name, hex: h, role: roleFromWords(`${name} ${usage}`), usage });
    }
    const bullet = line.replace(/^[-*•]\s+/, '');
    if (/^(do not|don't|never|always|avoid|use|keep|only)\b/i.test(bullet) && bullet.length > 12 && bullet.length < 300 && /usage|rule|logo|do|don|guideline|clear/.test(section + bullet.toLowerCase())) {
      found.rules.push(bullet.replace(/[`*]/g, ''));
    }
    if (/typograph|font|typeface/.test(section) || /\bfont\b|typeface/i.test(line)) {
      for (const m of line.matchAll(/\*\*([A-Z][\w ]{2,40}?)\*\*/g)) {
        const family = m[1]!.trim();
        if (!found.fonts.some((f) => f.family === family)) found.fonts.push({ family, role: /head|display|title/i.test(line) ? 'headings' : 'text' });
      }
    }
  }
  return found;
}

function roleFromWords(words: string): Brand['colors'][number]['role'] {
  const w = words.toLowerCase();
  if (/do not use|avoid|never use/.test(w)) return 'avoid';
  if (/primary|brand blue|main/.test(w)) return 'primary';
  if (/background|bg\b|off.?white/.test(w)) return 'background';
  if (/text|ink|body copy/.test(w)) return 'text';
  if (/gradient/.test(w)) return 'gradient';
  if (/accent|highlight|light end/.test(w)) return 'accent';
  return 'secondary';
}

