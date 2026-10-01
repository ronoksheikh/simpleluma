import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { HttpError } from '../lib/errors.js';
import { signToken, verifyToken } from '../lib/crypto.js';
import { projectDir, contentType } from '../projects/service.js';
import { buildManifest } from '../projects/manifest.js';
import { commitTree, workingTree, type ProjectSource } from '../projects/source.js';

/** `work` is the live working tree; otherwise a git commit. */
export type TreeRef = 'work' | string;

interface TreePayload extends Record<string, unknown> {
  p: string;
  ref: TreeRef;
}

export const treeToken = (projectId: string, ref: TreeRef, ttlMs: number): string => signToken({ p: projectId, ref }, ttlMs);

export function sourceFor(projectId: string, ref: TreeRef): ProjectSource {
  const dir = projectDir(projectId);
  return ref === 'work' ? workingTree(dir) : commitTree(dir, ref);
}

/**
 * Serve a project's files to the player. Video code is written by the agent, so the player runs in a sandboxed
 * frame without cookies: access is by the signed token in the URL, and the answers allow any origin.
 */
export async function serveTree(reply: FastifyReply, source: ProjectSource, path: string): Promise<FastifyReply> {
  // Uploaded HTML and SVG run as documents when opened directly: keep them in an opaque origin, away from the app's cookies.
  reply
    .header('access-control-allow-origin', '*')
    .header('cache-control', 'no-store')
    .header('x-content-type-options', 'nosniff')
    .header('content-security-policy', 'sandbox allow-scripts allow-pointer-lock');
  if (path === '__manifest') return reply.send(await buildManifest(source));
  return reply.type(contentType(path)).send(await source.read(path));
}

export const treeRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { token: string; '*': string } }>('/t/:token/*', async (req, reply) => {
    const payload = verifyToken<TreePayload>(req.params.token);
    if (!payload) throw new HttpError(403, 'This preview link has expired. Reload the page.');
    return serveTree(reply, sourceFor(payload.p, payload.ref), req.params['*']);
  });
};
