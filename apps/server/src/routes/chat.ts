import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { cancelQueued, clearChat, continueRun, isRunning, lastRun, listRunsUsage, projectUsage, runState, sendMessage, stopRun } from '../agent/loop.js';
import { listMessages } from '../agent/messages.js';
import { listCheckpoints } from '../director/checkpoints.js';
import { listTodos, replaceTodos, setTodoStatus } from '../director/todos.js';
import { conflict } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { getProject, restoreVersion } from '../projects/service.js';

const contextItem = z.discriminatedUnion('type', [
  z.object({ type: z.literal('scene'), path: z.string().max(300), start: z.number().min(0), duration: z.number().positive(), label: z.string().max(80).optional() }),
  z.object({ type: z.literal('frame'), time: z.number().min(0), imageUrl: z.string().max(500).optional() }),
]);

const messageBody = z.object({
  text: z.string().trim().min(1, 'Write a message').max(20_000),
  attachments: z.array(z.string().max(300).regex(/^(assets|references)\//, 'Attach files from assets/ or references/')).max(40).optional(),
  context: z.array(contextItem).max(8).optional(),
});

const originOf = (req: { headers: Record<string, string | string[] | undefined>; protocol: string }): string => {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol;
  return (req.headers.origin as string | undefined) ?? `${proto}://${req.headers.host as string}`;
};

export const chatRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>('/api/projects/:id/chat', async (req) => {
    const project = getProject(req.user.id, req.params.id);
    return {
      messages: listMessages(project.id),
      running: isRunning(project.id),
      live: runState(project.id),
      lastRun: lastRun(project.id),
      usage: projectUsage(project.id),
      todos: listTodos(project.id),
    };
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/chat', async (req, reply) => {
    const project = getProject(req.user.id, req.params.id);
    const body = parse(messageBody, req.body);
    const result = sendMessage(project, req.user.id, body, originOf(req));
    return reply.status(202).send({ ok: true, queued: result === 'queued' });
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/chat/continue', async (req, reply) => {
    const project = getProject(req.user.id, req.params.id);
    continueRun(project, req.user.id, originOf(req));
    return reply.status(202).send({ ok: true });
  });

  app.delete<{ Params: { id: string; qid: string } }>('/api/projects/:id/chat/queue/:qid', async (req) => {
    cancelQueued(getProject(req.user.id, req.params.id).id, req.params.qid);
    return { ok: true };
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

  // Plan ---------------------------------------------------------------------------------------

  app.get<{ Params: { id: string } }>('/api/projects/:id/todos', async (req) => listTodos(getProject(req.user.id, req.params.id).id));

  app.put<{ Params: { id: string } }>('/api/projects/:id/todos', async (req) => {
    const project = getProject(req.user.id, req.params.id);
    const { items } = parse(z.object({ items: z.array(z.object({ text: z.string().trim().min(1).max(300), status: z.enum(['pending', 'in_progress', 'done']) })).max(40) }), req.body);
    return replaceTodos(project.id, items);
  });

  app.patch<{ Params: { id: string; tid: string } }>('/api/projects/:id/todos/:tid', async (req) => {
    const project = getProject(req.user.id, req.params.id);
    const { status } = parse(z.object({ status: z.enum(['pending', 'in_progress', 'done']) }), req.body);
    return setTodoStatus(project.id, Number(req.params.tid), status);
  });

  // Checkpoints --------------------------------------------------------------------------------

  app.get<{ Params: { id: string } }>('/api/projects/:id/checkpoints', async (req) => listCheckpoints(getProject(req.user.id, req.params.id).id));

  app.post<{ Params: { id: string; cid: string } }>('/api/projects/:id/checkpoints/:cid/restore', async (req) => {
    const project = getProject(req.user.id, req.params.id);
    if (isRunning(project.id)) throw conflict('Stop the Director before restoring a checkpoint.');
    const checkpoint = listCheckpoints(project.id, 500).find((c) => c.id === req.params.cid);
    if (!checkpoint?.sha) throw conflict('This checkpoint has no saved version.');
    return { commit: await restoreVersion(project.id, checkpoint.sha) };
  });

  // Usage --------------------------------------------------------------------------------------

  app.get('/api/usage', async (req) => listRunsUsage(req.user.id));
};
