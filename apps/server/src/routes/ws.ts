import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { SESSION_COOKIE, userFromToken } from '../lib/auth.js';
import { hub } from '../lib/hub.js';
import { getProject } from '../projects/service.js';
import { watchProject } from '../projects/watcher.js';

const message = z.object({ type: z.enum(['subscribe', 'unsubscribe']), projectId: z.string() });

/** One socket per browser tab. The tab subscribes to the projects it shows. */
export const wsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/ws', { websocket: true }, (socket, req) => {
    const user = userFromToken(req.cookies[SESSION_COOKIE]);
    if (!user) return socket.close(4401, 'Not logged in');
    const client = hub.add(socket, user.id);
    const stops = new Map<string, () => void>();

    const unsubscribe = (projectId: string): void => {
      client.projects.delete(projectId);
      stops.get(projectId)?.();
      stops.delete(projectId);
    };

    socket.on('message', (raw) => {
      const parsed = message.safeParse(safeJson(raw.toString()));
      if (!parsed.success) return;
      const { type, projectId } = parsed.data;
      if (type === 'unsubscribe') return unsubscribe(projectId);
      try {
        getProject(user.id, projectId);
      } catch {
        return;
      }
      if (!client.projects.has(projectId)) {
        client.projects.add(projectId);
        stops.set(projectId, watchProject(projectId));
      }
    });

    socket.on('close', () => {
      [...client.projects].forEach(unsubscribe);
      hub.remove(client);
    });
  });
};

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
