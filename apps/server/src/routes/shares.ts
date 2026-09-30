import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { notFound } from '../lib/errors.js';
import { sendFileWithRanges } from '../lib/http.js';
import { parse } from '../lib/validate.js';
import { getProject } from '../projects/service.js';
import { getRender, renderFile } from '../render/service.js';
import { createShare, listShares, resolveShare, revokeShare } from '../shares/service.js';
import { serveTree, sourceFor } from './tree.js';

const createBody = z.object({
  kind: z.enum(['version', 'render']),
  target: z.string().optional(),
  expiresInHours: z.number().positive().max(24 * 365).nullable().optional(),
});

/** Owner-facing endpoints to create, list and revoke share links. */
export const shareRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>('/api/projects/:id/shares', async (req) => listShares(getProject(req.user.id, req.params.id).id));

  app.post<{ Params: { id: string } }>('/api/projects/:id/shares', async (req) => {
    const project = getProject(req.user.id, req.params.id);
    return createShare(project.id, parse(createBody, req.body));
  });

  app.delete<{ Params: { id: string; sid: string } }>('/api/projects/:id/shares/:sid', async (req) => {
    revokeShare(getProject(req.user.id, req.params.id).id, req.params.sid);
    return { ok: true };
  });
};

/** What anyone with the link can see. No login. */
export const publicShareRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { token: string } }>('/api/share/:token', async (req, reply) => {
    const share = resolveShare(req.params.token);
    reply.header('cache-control', 'no-store');
    return { kind: share.kind, title: share.projectName, label: share.label, expiresAt: share.expiresAt };
  });

  app.get<{ Params: { token: string; '*': string } }>('/api/share/:token/tree/*', async (req, reply) => {
    const share = resolveShare(req.params.token);
    if (share.kind !== 'version') throw notFound();
    return serveTree(reply, sourceFor(share.projectId, share.target), req.params['*']);
  });

  app.get<{ Params: { token: string } }>('/api/share/:token/video', async (req, reply) => {
    const share = resolveShare(req.params.token);
    if (share.kind !== 'render') throw notFound();
    const render = getRender(share.projectId, share.target);
    return sendFileWithRanges(req, reply.header('cache-control', 'no-store'), renderFile(render), 'video/mp4');
  });
};
