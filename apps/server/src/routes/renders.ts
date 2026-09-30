import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { notFound } from '../lib/errors.js';
import { sendFileWithRanges } from '../lib/http.js';
import { parse } from '../lib/validate.js';
import { getProject } from '../projects/service.js';
import { framesDir, thumbnail } from '../render/frame.js';
import { getRender, listRenders, renderFile, startRender, view } from '../render/service.js';

export const renderRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>('/api/projects/:id/renders', async (req) => listRenders(getProject(req.user.id, req.params.id).id));

  app.post<{ Params: { id: string } }>('/api/projects/:id/renders', async (req) => {
    const project = getProject(req.user.id, req.params.id);
    const { kind } = parse(z.object({ kind: z.enum(['preview', 'final']) }), req.body);
    return view(await startRender(project.id, kind));
  });

  app.get<{ Params: { id: string; rid: string }; Querystring: { download?: string } }>('/api/projects/:id/renders/:rid/file', async (req, reply) => {
    const project = getProject(req.user.id, req.params.id);
    const render = getRender(project.id, req.params.rid);
    if (render.status !== 'done') throw notFound('This render has no video');
    const name = `${project.name}-${render.kind === 'final' ? '1080p' : '480p'}.mp4`;
    return sendFileWithRanges(req, reply, renderFile(render), 'video/mp4', req.query.download ? name : undefined);
  });

  app.delete<{ Params: { id: string; rid: string } }>('/api/projects/:id/renders/:rid', async (req) => {
    const render = getRender(getProject(req.user.id, req.params.id).id, req.params.rid);
    db.delete(schema.shares).where(eq(schema.shares.target, render.id)).run();
    db.delete(schema.renders).where(eq(schema.renders.id, render.id)).run();
    await rm(renderFile(render), { force: true });
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/thumbnail', async (req, reply) => {
    const file = await thumbnail(getProject(req.user.id, req.params.id).id);
    if (!file) throw notFound('No thumbnail');
    return sendFileWithRanges(req, reply.header('cache-control', 'private, max-age=31536000, immutable'), file, 'image/jpeg');
  });

  app.get<{ Params: { id: string; name: string } }>('/api/projects/:id/frames/:name', async (req, reply) => {
    const project = getProject(req.user.id, req.params.id);
    const file = resolve(framesDir(project.id), req.params.name);
    if (!/^[\w-]+\.jpg$/.test(req.params.name) || !existsSync(file)) throw notFound('Frame not found');
    return sendFileWithRanges(req, reply.header('cache-control', 'private, max-age=31536000, immutable'), file, 'image/jpeg');
  });
};
