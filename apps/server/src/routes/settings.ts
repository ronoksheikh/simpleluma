import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { decrypt, encrypt, randomToken } from '../lib/crypto.js';
import { badRequest, notFound } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { resetUserTerminals } from '../terminal/manager.js';
import { getQuota, listVoices } from '../voice/elevenlabs.js';

const RESERVED = new Set(['PATH', 'HOME', 'PWD', 'SHELL', 'USER', 'LANG', 'TERM', 'NODE_OPTIONS', 'LD_PRELOAD', 'LD_LIBRARY_PATH']);
const secretBody = z.object({
  name: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,63}$/, 'Use letters, numbers and underscores, for example MY_API_KEY').refine((n) => !RESERVED.has(n), 'This name is reserved'),
  value: z.string().min(1, 'Enter the secret value').max(4096),
});
const keyBody = z.object({ apiKey: z.string().trim().min(1, 'Enter the ElevenLabs API key') });

/** All of a user's secrets, decrypted. Names go to the agent; values only ever reach the sandbox environment. */
export function loadSecrets(userId: string): Record<string, string> {
  return Object.fromEntries(
    db.select().from(schema.secrets).where(eq(schema.secrets.userId, userId)).all().map((s) => [s.name, decrypt(s.valueEnc)]),
  );
}

export function elevenLabsKey(userId: string): string | null {
  const row = db.select({ enc: schema.users.elevenLabsKeyEnc }).from(schema.users).where(eq(schema.users.id, userId)).get();
  return row?.enc ? decrypt(row.enc) : null;
}

async function checkKey(apiKey: string) {
  const voices = await listVoices(apiKey);
  return { voices, quota: await getQuota(apiKey) };
}

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/settings', async (req) => {
    const key = elevenLabsKey(req.user.id);
    return {
      elevenLabs: { configured: key !== null, keyHint: key ? `…${key.slice(-4)}` : null },
      secrets: db
        .select({ id: schema.secrets.id, name: schema.secrets.name, createdAt: schema.secrets.createdAt })
        .from(schema.secrets)
        .where(eq(schema.secrets.userId, req.user.id))
        .all(),
    };
  });

  app.post('/api/settings/elevenlabs/test', async (req) => {
    const body = parse(z.object({ apiKey: z.string().trim().optional() }), req.body);
    const apiKey = body.apiKey || elevenLabsKey(req.user.id);
    if (!apiKey) throw badRequest('Enter the ElevenLabs API key');
    return checkKey(apiKey);
  });

  app.put('/api/settings/elevenlabs', async (req) => {
    const { apiKey } = parse(keyBody, req.body);
    await checkKey(apiKey); // Save only works for a key that passes the test.
    db.update(schema.users).set({ elevenLabsKeyEnc: encrypt(apiKey) }).where(eq(schema.users.id, req.user.id)).run();
    return { ok: true };
  });

  app.delete('/api/settings/elevenlabs', async (req) => {
    db.update(schema.users).set({ elevenLabsKeyEnc: null }).where(eq(schema.users.id, req.user.id)).run();
    return { ok: true };
  });

  app.put('/api/secrets', async (req) => {
    const { name, value } = parse(secretBody, req.body);
    const existing = db.select().from(schema.secrets).where(and(eq(schema.secrets.userId, req.user.id), eq(schema.secrets.name, name))).get();
    if (existing) db.update(schema.secrets).set({ valueEnc: encrypt(value) }).where(eq(schema.secrets.id, existing.id)).run();
    else db.insert(schema.secrets).values({ id: randomToken(9), userId: req.user.id, name, valueEnc: encrypt(value), createdAt: Date.now() }).run();
    resetUserTerminals(req.user.id);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/secrets/:id', async (req) => {
    const where = and(eq(schema.secrets.id, req.params.id), eq(schema.secrets.userId, req.user.id));
    if (!db.select().from(schema.secrets).where(where).get()) throw notFound('Secret not found');
    db.delete(schema.secrets).where(where).run();
    resetUserTerminals(req.user.id);
    return { ok: true };
  });
};
