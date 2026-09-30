import { randomBytes } from 'node:crypto';
import { cp, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { and, desc, eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import * as gitRepo from '../lib/git.js';
import { hub } from '../lib/hub.js';
import { createProjectDir, giveToSandbox, giveTreeToSandbox, safePath } from '../lib/sandbox.js';
import { workingTree } from './source.js';

export type Project = typeof schema.projects.$inferSelect;
export type Template = 'blank' | 'demo';

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
  await gitRepo.commitAll(dir, template === 'demo' ? 'Start from the demo reel' : 'Create video');
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
};

export interface Attachment {
  name: string;
  path: string;
  type: string;
}

export async function listAttachments(projectId: string): Promise<Attachment[]> {
  const files = await listProjectFiles(projectId);
  return files
    .filter((f) => /^assets\/[^/]+$/.test(f) && ATTACHMENT_TYPES[extname(f).toLowerCase()])
    .map((path) => ({ name: basename(path), path, type: ATTACHMENT_TYPES[extname(path).toLowerCase()]! }));
}

export async function addAttachments(projectId: string, files: Array<{ filename: string; data: Buffer }>): Promise<string[]> {
  const existing = await listAttachments(projectId);
  if (existing.length + files.length > config.maxAttachments) {
    throw badRequest(`A video can have up to ${config.maxAttachments} attachments (${existing.length} already added).`);
  }
  const taken = new Set(existing.map((a) => a.name));
  const added: string[] = [];
  for (const file of files) {
    const ext = extname(file.filename).toLowerCase();
    if (!ATTACHMENT_TYPES[ext]) throw badRequest(`"${file.filename}" is not supported. Attach images (PNG, JPG, GIF, WebP), SVGs or PDFs.`);
    const stem = basename(file.filename, extname(file.filename)).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'file';
    let name = `${stem}${ext}`;
    for (let n = 2; taken.has(name); n++) name = `${stem}-${n}${ext}`;
    taken.add(name);
    await writeProjectFile(projectId, join('assets', name), file.data);
    added.push(name);
  }
  await commitProject(projectId, `Add attachments: ${added.join(', ')}`);
  return added;
}

export async function removeAttachment(projectId: string, name: string): Promise<void> {
  const attachment = (await listAttachments(projectId)).find((a) => a.name === name);
  if (!attachment) throw notFound('Attachment not found');
  await removeProjectFile(projectId, attachment.path);
  await commitProject(projectId, `Remove attachment: ${name}`);
}

export const contentType = (path: string): string =>
  ({
    '.json': 'application/json',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.txt': 'text/plain',
    '.md': 'text/plain',
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
