import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { clearChat, isRunning, startRun, stopRun } from '../agent/loop.js';
import { listMessages } from '../agent/messages.js';
import { conflict } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { getProject } from '../projects/service.js';

export const chatRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>('/api/projects/:id/chat', async (req) => {
    const project = getProject(req.user.id, req.params.id);
    return { messages: listMessages(project.id), running: isRunning(project.id) };
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/chat', async (req, reply) => {
    const project = getProject(req.user.id, req.params.id);
    const { text } = parse(z.object({ text: z.string().trim().min(1, 'Write a message').max(20_000) }), req.body);
    const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol;
    startRun(project, req.user.id, text, req.headers.origin ?? `${proto}://${req.headers.host}`);
    return reply.status(202).send({ ok: true });
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/chat/stop', async (req) => {
    stopRun(getProject(req.user.id, req.params.id).id);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/projects/:id/chat', async (req) => {
    const project = getProject(req.user.id, req.params.id);
    if (isRunning(project.id)) throw conflict('Stop the current run before clearing the chat.');
    clearChat(project.id);
    return { ok: true };
  });
};
