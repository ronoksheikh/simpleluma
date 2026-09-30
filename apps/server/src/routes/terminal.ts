import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { SESSION_COOKIE, userFromToken } from '../lib/auth.js';
import { getProject } from '../projects/service.js';
import { loadSecrets } from './settings.js';
import { agentTerminalText, attachUserTerminal } from '../terminal/manager.js';

const message = z.discriminatedUnion('type', [
  z.object({ type: z.literal('input'), data: z.string().max(65536) }),
  z.object({ type: z.literal('resize'), cols: z.number().int(), rows: z.number().int() }),
]);

export const terminalRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>('/api/projects/:id/terminal/agent', async (req) => ({
    data: agentTerminalText(getProject(req.user.id, req.params.id).id),
  }));

  app.get<{ Params: { id: string } }>('/ws/terminal/:id', { websocket: true }, (socket, req) => {
    const user = userFromToken(req.cookies[SESSION_COOKIE]);
    if (!user) return socket.close(4401, 'Not logged in');
    let project;
    try {
      project = getProject(user.id, (req.params as { id: string }).id);
    } catch {
      return socket.close(4404, 'Video not found');
    }
    const term = attachUserTerminal(project.id, user.id, loadSecrets(user.id), (data) => socket.send(data));
    socket.on('message', (raw) => {
      let json: unknown;
      try {
        json = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const parsed = message.safeParse(json);
      if (!parsed.success) return;
      if (parsed.data.type === 'input') term.write(parsed.data.data);
      else term.resize(parsed.data.cols, parsed.data.rows);
    });
    socket.on('close', term.detach);
  });
};
