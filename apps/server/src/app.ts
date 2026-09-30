import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { config } from './config.js';
import { requireUser } from './lib/auth.js';
import { HttpError } from './lib/errors.js';
import { authRoutes } from './routes/auth.js';
import { chatRoutes } from './routes/chat.js';
import { modelRoutes } from './routes/models.js';
import { projectRoutes } from './routes/projects.js';
import { renderRoutes } from './routes/renders.js';
import { settingsRoutes } from './routes/settings.js';
import { publicShareRoutes, shareRoutes } from './routes/shares.js';
import { terminalRoutes } from './routes/terminal.js';
import { treeRoutes } from './routes/tree.js';
import { wsRoutes } from './routes/ws.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, bodyLimit: 25 * 1024 * 1024, maxParamLength: 1000 });

  app.setErrorHandler((error: FastifyError, req, reply) => {
    if (error instanceof HttpError) return reply.status(error.status).send({ error: error.message });
    if (error instanceof ZodError) return reply.status(400).send({ error: error.issues[0]?.message ?? 'Invalid request' });
    if (error.statusCode && error.statusCode < 500) return reply.status(error.statusCode).send({ error: error.message });
    req.log.error(error);
    return reply.status(500).send({ error: 'Something went wrong on the server.' });
  });

  await app.register(cookie);
  await app.register(websocket);
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: config.maxAttachments } });

  // The player and framework files are public: they contain no user data.
  await app.register(fastifyStatic, {
    root: resolve(config.motionDir, 'web'),
    prefix: '/motion/',
    decorateReply: false,
    setHeaders: (res) => res.setHeader('access-control-allow-origin', '*'),
  });
  const playerHtml = readFileSync(resolve(config.motionDir, 'web/player.html'), 'utf8');
  app.get('/player', (_req, reply) => reply.header('cache-control', 'no-cache').type('text/html').send(playerHtml));

  app.get('/api/health', () => ({ ok: true }));
  await app.register(authRoutes);
  await app.register(treeRoutes);
  await app.register(publicShareRoutes);

  await app.register(async (api) => {
    api.addHook('preHandler', async (req) => {
      if (req.url.startsWith('/api/') || req.url === '/ws') await requireUser(req);
    });
    await api.register(modelRoutes);
    await api.register(settingsRoutes);
    await api.register(projectRoutes);
    await api.register(renderRoutes);
    await api.register(chatRoutes);
    await api.register(shareRoutes);
    await api.register(terminalRoutes);
  });
  await app.register(wsRoutes);

  if (existsSync(config.webDir)) {
    await app.register(fastifyStatic, { root: config.webDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/t/')) return reply.status(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
