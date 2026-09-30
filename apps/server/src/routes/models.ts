import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { decrypt, encrypt, randomToken } from '../lib/crypto.js';
import { notFound } from '../lib/errors.js';
import { listModels, normalizeBaseUrl, testModel } from '../lib/llm.js';
import { parse } from '../lib/validate.js';

const endpointBody = z.object({ baseUrl: z.string().min(1, 'Enter the base URL'), apiKey: z.string().trim().min(1, 'Enter the API key') });
const profileBody = endpointBody.extend({ model: z.string().min(1, 'Pick a model'), name: z.string().trim().max(60).optional() });

export interface ModelProfile {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** The profile the agent uses for a user, with its key decrypted. */
export function activeProfile(userId: string): ModelProfile | null {
  const row = db
    .select()
    .from(schema.modelProfiles)
    .where(and(eq(schema.modelProfiles.userId, userId), eq(schema.modelProfiles.active, true)))
    .get();
  return row ? { id: row.id, name: row.name, baseUrl: row.baseUrl, apiKey: decrypt(row.apiKeyEnc), model: row.model } : null;
}

export const modelRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/models', async (req) =>
    db
      .select()
      .from(schema.modelProfiles)
      .where(eq(schema.modelProfiles.userId, req.user.id))
      .all()
      .map((p) => ({ id: p.id, name: p.name, baseUrl: p.baseUrl, model: p.model, active: p.active, keyHint: `…${decrypt(p.apiKeyEnc).slice(-4)}` })),
  );

  app.post('/api/models/available', async (req) => {
    const { baseUrl, apiKey } = parse(endpointBody, req.body);
    return { models: await listModels({ baseUrl, apiKey }) };
  });

  app.post('/api/models/test', async (req) => {
    const { baseUrl, apiKey, model } = parse(profileBody, req.body);
    await testModel({ baseUrl, apiKey }, model);
    return { ok: true };
  });

  app.post('/api/models', async (req) => {
    const body = parse(profileBody, req.body);
    const baseUrl = normalizeBaseUrl(body.baseUrl);
    await testModel({ baseUrl, apiKey: body.apiKey }, body.model);
    const hasActive = activeProfile(req.user.id) !== null;
    const id = randomToken(9);
    db.insert(schema.modelProfiles)
      .values({
        id,
        userId: req.user.id,
        name: body.name || `${new URL(baseUrl).hostname} · ${body.model}`,
        baseUrl,
        apiKeyEnc: encrypt(body.apiKey),
        model: body.model,
        active: !hasActive,
        createdAt: Date.now(),
      })
      .run();
    return { id };
  });

  app.post<{ Params: { id: string } }>('/api/models/:id/activate', async (req) => {
    const row = db.select().from(schema.modelProfiles).where(and(eq(schema.modelProfiles.id, req.params.id), eq(schema.modelProfiles.userId, req.user.id))).get();
    if (!row) throw notFound('Model profile not found');
    db.update(schema.modelProfiles).set({ active: false }).where(eq(schema.modelProfiles.userId, req.user.id)).run();
    db.update(schema.modelProfiles).set({ active: true }).where(eq(schema.modelProfiles.id, row.id)).run();
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/models/:id', async (req) => {
    const where = and(eq(schema.modelProfiles.id, req.params.id), eq(schema.modelProfiles.userId, req.user.id));
    const row = db.select().from(schema.modelProfiles).where(where).get();
    if (!row) throw notFound('Model profile not found');
    db.delete(schema.modelProfiles).where(where).run();
    if (row.active) {
      const next = db.select().from(schema.modelProfiles).where(eq(schema.modelProfiles.userId, req.user.id)).get();
      if (next) db.update(schema.modelProfiles).set({ active: true }).where(eq(schema.modelProfiles.id, next.id)).run();
    }
    return { ok: true };
  });
};
