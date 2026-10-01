import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chown, cp, mkdir, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { and, desc, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import * as gitRepo from '../lib/git.js';
import { hub } from '../lib/hub.js';
import { createProjectDir, giveToSandbox, giveTreeToSandbox, safePath, sandboxUser } from '../lib/sandbox.js';
import { workingTree } from './source.js';

const exec = promisify(execFile);

export type Project = typeof schema.projects.$inferSelect;
export type Template = 'blank' | 'demo' | 'three' | 'kinetic';

export const projectDir = (id: string): string => resolve(config.projectsDir, id);

export function getProject(userId: string, id: string): Project {
  const project = db.select().from(schema.projects).where(and(eq(schema.projects.id, id), eq(schema.projects.userId, userId))).get();
  if (!project) throw notFound('Video not found');
  return project;
}

export function listProjects(userId: string): Project[] {
  return db.select().from(schema.projects).where(eq(schema.projects.userId, userId)).orderBy(desc(schema.projects.updatedAt)).all();
}

export async function createProject(userId: string, name: string, template: Template): Promise<Project> {
  const id = randomBytes(9).toString('base64url');
  const dir = projectDir(id);
  await createProjectDir(dir);
  await cp(resolve(config.motionDir, 'templates', template), dir, { recursive: true });
  await giveTreeToSandbox(dir);
  await gitRepo.initRepo(dir);
  await gitRepo.commitAll(dir, template === 'blank' ? 'Create video' : `Start from the ${template} template`);
  const now = Date.now();
  const project = { id, userId, name, createdAt: now, updatedAt: now };
  db.insert(schema.projects).values(project).run();
  return project;
}

export async function deleteProject(project: Project): Promise<void> {
  db.delete(schema.projects).where(eq(schema.projects.id, project.id)).run();
  await Promise.all(
    [projectDir(project.id), resolve(config.rendersDir, project.id), resolve(config.cacheDir, project.id), resolve(config.framesDir, project.id)].map(
      (p) => rm(p, { recursive: true, force: true }),
    ),
  );
}

export function touch(projectId: string): void {
  db.update(schema.projects).set({ updatedAt: Date.now() }).where(eq(schema.projects.id, projectId)).run();
}

/** Commit everything in the project folder and tell the open browsers the history changed. */
export async function commitProject(projectId: string, message: string): Promise<string | null> {
  const sha = await gitRepo.commitAll(projectDir(projectId), message);
  if (sha) {
    touch(projectId);
    hub.publish(projectId, { type: 'history.changed' });
  }
  return sha;
}

export async function restoreVersion(projectId: string, sha: string): Promise<string | null> {
  const dir = projectDir(projectId);
  if (!(await gitRepo.isCommit(dir, sha))) throw notFound('Version not found');
  await gitRepo.commitAll(dir, 'Save changes before restoring');
  const created = await gitRepo.restore(dir, sha);
  touch(projectId);
  hub.publish(projectId, { type: 'history.changed' });
  return created;
}

export async function writeProjectFile(projectId: string, path: string, data: string | Buffer): Promise<void> {
  const dir = projectDir(projectId);
  if (path.split('/').includes('.git')) throw badRequest('The .git folder cannot be edited.');
  const target = await safePath(dir, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, data);
  await giveToSandbox(target, dir);
}

export async function removeProjectFile(projectId: string, path: string): Promise<void> {
  await unlink(await safePath(projectDir(projectId), path));
}

export const readProjectFile = (projectId: string, path: string): Promise<Buffer> => workingTree(projectDir(projectId)).read(path);

export const listProjectFiles = (projectId: string): Promise<string[]> => workingTree(projectDir(projectId)).list();

// Attachments ----------------------------------------------------------------------------------

const ATTACHMENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
};

const ZIP_LIMITS = { files: 400, bytes: 200 * 1024 * 1024 };

export interface Attachment {
  name: string;
  path: string;
  type: string;
  /** HTML files are motion references: the Director studies them and the Assets tab can play them. */
  reference: boolean;
}

const isAttachmentPath = (f: string): boolean => /^(assets|references)\//.test(f) && ATTACHMENT_TYPES[extname(f).toLowerCase()] !== undefined;

export async function listAttachments(projectId: string): Promise<Attachment[]> {
  const files = await listProjectFiles(projectId);
  return files
    .filter(isAttachmentPath)
    .sort()
    .map((path) => {
      const type = ATTACHMENT_TYPES[extname(path).toLowerCase()]!;
      return { name: path.replace(/^(assets|references)\//, ''), path, type, reference: type === 'text/html' };
    });
}

const cleanStem = (filename: string): string =>
  basename(filename, extname(filename)).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'file';

/** Unpack a zip into `assets/<name>/` as the sandbox user, refusing bombs, links and paths outside the folder. */
async function extractZip(projectId: string, filename: string, data: Buffer, folder: string): Promise<string[]> {
  const dir = projectDir(projectId);
  const tmp = resolve(config.dataDir, 'tmp');
  await mkdir(tmp, { recursive: true, mode: 0o711 });
  const zipFile = resolve(tmp, `${randomBytes(8).toString('hex')}.zip`);
  await writeFile(zipFile, data);
  try {
    if (sandboxUser) await chown(zipFile, sandboxUser.uid, sandboxUser.gid);
    let listing: string;
    try {
      listing = (await exec('unzip', ['-Z', '-l', zipFile], { maxBuffer: 16 * 1024 * 1024 })).stdout;
    } catch {
      throw badRequest(`"${filename}" is not a valid zip file.`);
    }
    const entries = listing.split('\n').filter((l) => /^[-l]/.test(l));
    if (entries.some((l) => l.startsWith('l'))) throw badRequest(`"${filename}" contains symbolic links, which are not allowed.`);
    const files = entries.filter((l) => l.startsWith('-'));
    const total = files.reduce((n, l) => n + Number(l.trim().split(/\s+/)[3] ?? 0), 0);
    if (files.length > ZIP_LIMITS.files) throw badRequest(`"${filename}" has ${files.length} files; the limit is ${ZIP_LIMITS.files}.`);
    if (total > ZIP_LIMITS.bytes) throw badRequest(`"${filename}" unpacks to ${Math.round(total / 1e6)} MB; the limit is ${ZIP_LIMITS.bytes / 1e6} MB.`);
    const target = resolve(dir, folder);
    await mkdir(target, { recursive: true });
    await giveToSandbox(target, dir);
    // -n: never overwrite, -: is off by default so "../" entries are refused; run as the sandbox user.
    await exec('unzip', ['-qq', '-n', zipFile, '-x', '__MACOSX/*', '*/.DS_Store', '.DS_Store', '-d', target], { maxBuffer: 16 * 1024 * 1024, ...sandboxUser }).catch((e: { code?: number }) => {
      if (e.code !== 1) throw badRequest(`Could not unpack "${filename}".`); // 1 = warnings only
    });
    const kept: string[] = [];
    for (const entry of await readdir(target, { recursive: true, withFileTypes: true })) {
      const full = resolve(entry.parentPath, entry.name);
      const rel = relative(dir, full).split(sep).join('/');
      if (entry.isSymbolicLink() || (entry.isFile() && !ATTACHMENT_TYPES[extname(entry.name).toLowerCase()])) {
        await rm(full, { force: true });
        continue;
      }
      if (entry.isFile()) kept.push(rel);
    }
    return kept.sort();
  } finally {
    await rm(zipFile, { force: true });
  }
}

export interface AddedFile {
  name: string;
  path: string;
}

export async function addAttachments(projectId: string, files: Array<{ filename: string; data: Buffer }>): Promise<AddedFile[]> {
  const existing = await listAttachments(projectId);
  if (existing.length + files.length > config.maxAttachments) {
    throw badRequest(`A video can have up to ${config.maxAttachments} files (${existing.length} already added).`);
  }
  const taken = new Set(existing.map((a) => a.path.toLowerCase()));
  const unique = (folder: string, stem: string, ext: string): string => {
    let path = `${folder}/${stem}${ext}`;
    for (let n = 2; taken.has(path.toLowerCase()); n++) path = `${folder}/${stem}-${n}${ext}`;
    taken.add(path.toLowerCase());
    return path;
  };
  const added: AddedFile[] = [];
  for (const file of files) {
    const ext = extname(file.filename).toLowerCase();
    if (ext === '.zip') {
      const folder = unique('assets', cleanStem(file.filename), '');
      for (const path of await extractZip(projectId, file.filename, file.data, folder)) added.push({ name: path.replace(/^assets\//, ''), path });
      continue;
    }
    if (!ATTACHMENT_TYPES[ext]) {
      throw badRequest(`"${file.filename}" is not supported. Attach images, SVGs, PDFs, zips, HTML motion references, brand docs (MD/TXT), fonts or audio.`);
    }
    const path = unique(ext === '.html' || ext === '.htm' ? 'references' : 'assets', cleanStem(file.filename), ext);
    await writeProjectFile(projectId, path, file.data);
    added.push({ name: basename(path), path });
  }
  if (!added.length) throw badRequest('Nothing usable was found in the upload.');
  await commitProject(projectId, `Add files: ${added.slice(0, 6).map((a) => a.name).join(', ')}${added.length > 6 ? ` and ${added.length - 6} more` : ''}`);
  return added;
}

export async function removeAttachment(projectId: string, path: string): Promise<void> {
  const attachment = (await listAttachments(projectId)).find((a) => a.path === path);
  if (!attachment) throw notFound('File not found');
  await removeProjectFile(projectId, attachment.path);
  await commitProject(projectId, `Remove file: ${attachment.name}`);
}

export const contentType = (path: string): string =>
  ({
    '.json': 'application/json',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.txt': 'text/plain',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.mp4': 'video/mp4',
    ...ATTACHMENT_TYPES,
  })[extname(path).toLowerCase()] ?? 'application/octet-stream';
