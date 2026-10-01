import { execFile } from 'node:child_process';
import { basename, extname } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { hub } from '../lib/hub.js';
import { commandEnv, safePath, sandboxUser } from '../lib/sandbox.js';
import { commitProject, listProjectFiles, projectDir, readProjectFile, writeProjectFile } from '../projects/service.js';
import { inspectImage } from '../render/inspect.js';

const exec = promisify(execFile);
export const BRAND_FILE = 'brand.json';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colours are #RRGGBB');
export const brandSchema = z.object({
  name: z.string().max(120).default(''),
  colors: z
    .array(z.object({
      name: z.string().max(80).default(''),
      hex,
      role: z.enum(['primary', 'secondary', 'accent', 'background', 'text', 'gradient', 'detected', 'avoid']).default('detected'),
      usage: z.string().max(300).default(''),
    }))
    .max(48)
    .default([]),
  gradients: z.array(z.string().max(400)).max(16).default([]),
  fonts: z.array(z.object({ family: z.string().max(80), role: z.string().max(80).default('') })).max(12).default([]),
  logos: z.array(z.object({ path: z.string().max(300), use: z.string().max(200).default('') })).max(24).default([]),
  rules: z.array(z.string().max(400)).max(40).default([]),
  tone: z.string().max(1000).default(''),
  sources: z.array(z.string().max(300)).max(100).default([]),
  /** True once a person saved the Brand tab: detection then only adds, never renames or re-roles. */
  edited: z.boolean().default(false),
  updatedAt: z.number().default(0),
});

export type Brand = z.infer<typeof brandSchema>;
export const emptyBrand = (): Brand => brandSchema.parse({});

export async function readBrand(projectId: string): Promise<Brand | null> {
  try {
    const raw = JSON.parse((await readProjectFile(projectId, BRAND_FILE)).toString('utf8')) as unknown;
    const parsed = brandSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function writeBrand(projectId: string, brand: Brand, message: string): Promise<Brand> {
  const clean = brandSchema.parse({ ...brand, colors: dedupeColors(brand.colors), updatedAt: Date.now() });
  await writeProjectFile(projectId, BRAND_FILE, `${JSON.stringify(clean, null, 2)}\n`);
  await commitProject(projectId, message);
  hub.publish(projectId, { type: 'brand.changed' });
  return clean;
}

function dedupeColors(colors: Brand['colors']): Brand['colors'] {
  const seen = new Set<string>();
  return colors
    .map((c) => ({ ...c, hex: c.hex.toUpperCase() }))
    .filter((c) => (seen.has(c.hex) ? false : (seen.add(c.hex), true)));
}

// Detection ---------------------------------------------------------------------------------------

interface Found {
  name?: string;
  colors: Brand['colors'];
  gradients: string[];
  fonts: Brand['fonts'];
  logos: Brand['logos'];
  rules: string[];
}

const empty = (): Found => ({ colors: [], gradients: [], fonts: [], logos: [], rules: [] });

const toHex6 = (c: string): string | null => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? m[1]!.split('').map((x) => x + x).join('') : m[1]!;
  return `#${h.toUpperCase()}`;
};

/** Near-white, near-black and greys are rarely brand colours when found in artwork. */
function isNeutral(h: string): boolean {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  return Math.max(r, g, b) - Math.min(r, g, b) < 18;
}

const LOGO_NAME = /logo|icon|mark|symbol|wordmark|emblem|lockup|monogram|favicon/i;

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

function logoUse(path: string): string {
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

const IMAGE_MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

async function detectFile(projectId: string, path: string): Promise<Found | null> {
  const ext = extname(path).toLowerCase();
  try {
    if (ext === '.svg') return detectFromSvg(path, (await readProjectFile(projectId, path)).toString('utf8'));
    if (ext === '.md' || ext === '.txt') return detectFromText((await readProjectFile(projectId, path)).toString('utf8'));
    if (ext === '.pdf') {
      const file = await safePath(projectDir(projectId), path);
      const { stdout } = await exec('pdftotext', ['-layout', file, '-'], { maxBuffer: 16 * 1024 * 1024, env: commandEnv(), ...sandboxUser });
      return detectFromText(stdout);
    }
    if (IMAGE_MIME[ext] && LOGO_NAME.test(path)) {
      // Photos say little about a brand; logo images do.
      const info = await inspectImage(await readProjectFile(projectId, path), IMAGE_MIME[ext]!);
      const found = empty();
      for (const c of info.colors.slice(0, 4)) {
        const h = toHex6(c);
        if (h && !isNeutral(h)) found.colors.push({ name: '', hex: h, role: 'detected', usage: `seen in ${basename(path)}` });
      }
      found.logos.push({ path, use: logoUse(path) });
      return found;
    }
  } catch {
    return null;
  }
  return null;
}

export const BRAND_SOURCE = /\.(svg|png|jpe?g|webp|gif|pdf|md|txt)$/i;

/** Merge what new files say about the brand into brand.json. Edited values stay as the person set them. */
export async function detectBrand(projectId: string, paths: string[]): Promise<Brand | null> {
  const sources = paths.filter((p) => BRAND_SOURCE.test(p) && /^(assets|references)\//.test(p));
  if (!sources.length) return null;
  const brand = (await readBrand(projectId)) ?? emptyBrand();
  const before = JSON.stringify(brand);
  const has = new Set(brand.colors.map((c) => c.hex.toUpperCase()));
  let detected = brand.colors.filter((c) => c.role === 'detected').length;
  // Documents name their colours, so read them before artwork.
  const ordered = [...sources].sort((a, b) => Number(/\.(md|txt|pdf)$/i.test(b)) - Number(/\.(md|txt|pdf)$/i.test(a)));
  for (const path of ordered) {
    const found = await detectFile(projectId, path);
    if (!found) continue;
    if (!brand.name && found.name) brand.name = found.name;
    for (const c of found.colors) {
      if (has.has(c.hex)) continue;
      if (c.role === 'detected' && ++detected > 16) continue;
      has.add(c.hex);
      brand.colors.push(c);
    }
    for (const g of found.gradients) if (!brand.gradients.includes(g) && brand.gradients.length < 16) brand.gradients.push(g);
    for (const f of found.fonts) if (!brand.fonts.some((x) => x.family.toLowerCase() === f.family.toLowerCase()) && brand.fonts.length < 12) brand.fonts.push(f);
    for (const l of found.logos) if (!brand.logos.some((x) => x.path === l.path) && brand.logos.length < 24) brand.logos.push(l);
    for (const r of found.rules) if (!brand.rules.includes(r) && brand.rules.length < 40) brand.rules.push(r);
    if (!brand.sources.includes(path) && brand.sources.length < 100) brand.sources.push(path);
  }
  if (JSON.stringify(brand) === before) return brand;
  return writeBrand(projectId, brand, 'Update brand.json from uploads');
}

/** Re-read every brand file in the project. */
export async function rescanBrand(projectId: string): Promise<Brand | null> {
  return detectBrand(projectId, await listProjectFiles(projectId));
}

/** brand.json as the Director reads it in its instructions. */
export function describeBrand(brand: Brand | null): string {
  if (!brand) return 'No brand.json yet. When the user attaches brand material, read it and record the brand with update_brand.';
  const lines: string[] = [];
  if (brand.name) lines.push(`Brand: ${brand.name}`);
  const use = brand.colors.filter((c) => c.role !== 'avoid');
  const avoid = brand.colors.filter((c) => c.role === 'avoid');
  if (use.length) lines.push(`Colours:\n${use.map((c) => `- ${c.hex}${c.name ? ` ${c.name}` : ''} (${c.role})${c.usage ? `: ${c.usage}` : ''}`).join('\n')}`);
  if (avoid.length) lines.push(`NEVER use these colours: ${avoid.map((c) => `${c.hex}${c.name ? ` (${c.name})` : ''}`).join(', ')}`);
  if (brand.gradients.length) lines.push(`Gradients:\n${brand.gradients.map((g) => `- ${g}`).join('\n')}`);
  if (brand.fonts.length) lines.push(`Fonts: ${brand.fonts.map((f) => `${f.family}${f.role ? ` (${f.role})` : ''}`).join(', ')}`);
  if (brand.logos.length) lines.push(`Logos:\n${brand.logos.map((l) => `- ${l.path}${l.use ? `: ${l.use}` : ''}`).join('\n')}`);
  if (brand.rules.length) lines.push(`Rules:\n${brand.rules.map((r) => `- ${r}`).join('\n')}`);
  if (brand.tone) lines.push(`Tone: ${brand.tone}`);
  return lines.join('\n') || 'brand.json exists but is empty.';
}
