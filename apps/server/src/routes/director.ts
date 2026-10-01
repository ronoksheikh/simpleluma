import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { DEFAULT_DIRECTOR_PROMPT } from '../agent/prompt.js';
import { addMemory, listMemories, removeMemory, updateMemory } from '../director/memory.js';
import { getDirectorPrompt, getPreferences, preferencesSchema, setDirectorPrompt, setPreferences } from '../director/preferences.js';
import { parse } from '../lib/validate.js';
import { getProject } from '../projects/service.js';

export const directorRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/director', async (req) => {
    const prompt = getDirectorPrompt(req.user.id);
    return { prompt: prompt ?? DEFAULT_DIRECTOR_PROMPT, custom: prompt !== null, defaultPrompt: DEFAULT_DIRECTOR_PROMPT, preferences: getPreferences(req.user.id) };
  });

  app.put('/api/director', async (req) => {
    const body = parse(z.object({ prompt: z.string().max(20_000).nullable().optional(), preferences: preferencesSchema.partial().optional() }), req.body);
    if (body.prompt !== undefined) setDirectorPrompt(req.user.id, body.prompt === DEFAULT_DIRECTOR_PROMPT ? null : body.prompt);
    const preferences = body.preferences ? setPreferences(req.user.id, body.preferences) : getPreferences(req.user.id);
    const prompt = getDirectorPrompt(req.user.id);
    return { prompt: prompt ?? DEFAULT_DIRECTOR_PROMPT, custom: prompt !== null, defaultPrompt: DEFAULT_DIRECTOR_PROMPT, preferences };
  });

  // Memory: global (every project) and per project.
  app.get<{ Querystring: { project?: string } }>('/api/memories', async (req) => {
    const projectId = req.query.project ? getProject(req.user.id, req.query.project).id : null;
    return listMemories(req.user.id, projectId);
  });

  app.post('/api/memories', async (req) => {
    const body = parse(z.object({ content: z.string().trim().min(2, 'Write something to remember').max(2000), project: z.string().optional() }), req.body);
    const projectId = body.project ? getProject(req.user.id, body.project).id : null;
    return addMemory(req.user.id, projectId, body.content, 'user');
  });

  app.patch<{ Params: { mid: string } }>('/api/memories/:mid', async (req) => {
    const { content } = parse(z.object({ content: z.string().trim().min(2).max(2000) }), req.body);
    updateMemory(req.user.id, req.params.mid, content);
    return { ok: true };
  });

  app.delete<{ Params: { mid: string } }>('/api/memories/:mid', async (req) => {
    removeMemory(req.user.id, req.params.mid);
    return { ok: true };
  });
};
