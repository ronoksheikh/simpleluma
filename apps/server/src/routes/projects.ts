import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { badRequest } from '../lib/errors.js';
import * as gitRepo from '../lib/git.js';
import { parse } from '../lib/validate.js';
import { readVideoConfig } from '../projects/manifest.js';
import {
  addAttachments, contentType, createProject, deleteProject, getProject, listAttachments, listProjects,
  projectDir, readProjectFile, removeAttachment, restoreVersion,
} from '../projects/service.js';
import { workingTree } from '../projects/source.js';
import { treeToken } from './tree.js';
import { isRunning, lastRun, projectUsage, sendMessage } from '../agent/loop.js';
import { detectBrand } from '../brand/brand.js';
import { getPreferences } from '../director/preferences.js';

const TEMPLATES = ['blank', 'demo', 'three', 'kinetic'] as const;

/** A short project name from the first words of a brief. */
function titleFrom(prompt: string): string {
  const words = prompt.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 6).join(' ');
  return (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, 60) || 'Untitled video';
}

const PREVIEW_TOKEN_MS = 12 * 3600 * 1000;
const sha = z.string().regex(/^[0-9a-f]{7,40}$/, 'Invalid version');

export const projectRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/projects', async (req) =>
    Promise.all(
      listProjects(req.user.id).map(async (p) => {
        const run = lastRun(p.id);
        return {
          id: p.id,
          name: p.name,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          running: isRunning(p.id),
          lastRun: run ? { status: run.status, reason: run.reason, startedAt: run.startedAt } : null,
          video: await readVideoConfig(workingTree(projectDir(p.id))).catch(() => null),
          usage: projectUsage(p.id),
        };
      }),
    ),
  );

  app.post('/api/projects', async (req) => {
    const body = parse(
      z.object({
        name: z.string().trim().max(80).optional(),
        template: z.enum(TEMPLATES).default('blank'),
        /** Start the Director on this brief right away. */
        prompt: z.string().trim().max(20_000).optional(),
      }),
      req.body,
    );
    const name = body.name || (body.prompt ? titleFrom(body.prompt) : 'Untitled video');
    const project = await createProject(req.user.id, name, body.template);
    if (body.prompt) {
      const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol;
      try {
        sendMessage(project, req.user.id, { text: body.prompt }, req.headers.origin ?? `${proto}://${req.headers.host}`);
      } catch {
        // No model yet: the brief waits in the studio.
      }
    }
    return { id: project.id };
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req) => {
    const project = getProject(req.user.id, req.params.id);
    const dir = projectDir(project.id);
    return {
      id: project.id,
      name: project.name,
      updatedAt: project.updatedAt,
      video: await readVideoConfig(workingTree(dir)).catch(() => null),
      attachments: await listAttachments(project.id),
      head: await gitRepo.head(dir),
      running: isRunning(project.id),
      usage: projectUsage(project.id),
    };
  });

  app.patch<{ Params: { id: string } }>('/api/projects/:id', async (req) => {
    const project = getProject(req.user.id, req.params.id);
    const { name } = parse(z.object({ name: z.string().trim().min(1).max(80) }), req.body);
    db.update(schema.projects).set({ name }).where(eq(schema.projects.id, project.id)).run();
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req) => {
    await deleteProject(getProject(req.user.id, req.params.id));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/preview-token', async (req) => {
    const project = getProject(req.user.id, req.params.id);
    return { base: `/t/${treeToken(project.id, 'work', PREVIEW_TOKEN_MS)}` };
  });

  // History ------------------------------------------------------------------------------------

  app.get<{ Params: { id: string } }>('/api/projects/:id/history', async (req) =>
    gitRepo.log(projectDir(getProject(req.user.id, req.params.id).id)),
  );

  app.get<{ Params: { id: string; sha: string } }>('/api/projects/:id/commits/:sha', async (req) => {
    const project = getProject(req.user.id, req.params.id);
    const commit = parse(sha, req.params.sha);
    return { patch: await gitRepo.show(projectDir(project.id), commit) };
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/restore', async (req) => {
    const project = getProject(req.user.id, req.params.id);
    const body = parse(z.object({ sha }), req.body);
    return { commit: await restoreVersion(project.id, body.sha) };
  });

  // Files and attachments ----------------------------------------------------------------------

  app.get<{ Params: { id: string } }>('/api/projects/:id/files', async (req) =>
    (await workingTree(projectDir(getProject(req.user.id, req.params.id).id)).list()).sort(),
  );

  app.get<{ Params: { id: string; '*': string } }>('/api/projects/:id/files/*', async (req, reply) => {
    const project = getProject(req.user.id, req.params.id);
    const path = req.params['*'];
    const data = await readProjectFile(project.id, path);
    // Files come from the agent or the sandbox: never let the browser run them in the app's origin.
    return reply
      .header('content-security-policy', 'sandbox')
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'no-cache')
      .type(contentType(path))
      .send(data);
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/attachments', async (req) => {
    const project = getProject(req.user.id, req.params.id);
    const files: Array<{ filename: string; data: Buffer }> = [];
    for await (const part of req.files()) files.push({ filename: part.filename, data: await part.toBuffer() });
    if (!files.length) throw badRequest('Choose at least one file.');
    const added = await addAttachments(project.id, files);
    // With auto-detect on, brand files fill brand.json by rules in the background. Otherwise the Director reads them itself.
    if (getPreferences(req.user.id).autoBrand) void detectBrand(project.id, added.map((a) => a.path)).catch((e: unknown) => req.log.warn(e));
    return { added };
  });

  app.delete<{ Params: { id: string }; Querystring: { path?: string } }>('/api/projects/:id/attachments', async (req) => {
    const { path } = parse(z.object({ path: z.string().min(1) }), req.query);
    await removeAttachment(getProject(req.user.id, req.params.id).id, path);
    return { ok: true };
  });

};
