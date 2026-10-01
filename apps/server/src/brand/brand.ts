import { execFile } from 'node:child_process';
import { basename, extname } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { hub } from '../lib/hub.js';
import { commandEnv, safePath, sandboxUser } from '../lib/sandbox.js';
import { commitProject, listProjectFiles, projectDir, readProjectFile, writeProjectFile } from '../projects/service.js';
import { inspectImage } from '../render/inspect.js';
import { LOGO_NAME, detectFromSvg, detectFromText, empty, isNeutral, logoUse, toHex6, type Found } from './detect.js';

export { detectFromSvg, detectFromText };

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
