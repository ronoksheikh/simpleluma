import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { createSession, destroySession, requireUser, SESSION_COOKIE } from '../lib/auth.js';
import { hashPassword, randomToken, verifyPassword } from '../lib/crypto.js';
import { HttpError, conflict } from '../lib/errors.js';
import { parse } from '../lib/validate.js';

const email = z.string().trim().toLowerCase().email('Enter a valid email address');
const signup = z.object({ email, password: z.string().min(8, 'Use at least 8 characters').max(200) });
const login = z.object({ email, password: z.string().min(1, 'Enter your password') });

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/auth/signup', async (req, reply) => {
    const { email, password } = parse(signup, req.body);
    if (db.select().from(schema.users).where(eq(schema.users.email, email)).get()) {
      throw conflict('An account with this email already exists.');
    }
    const id = randomToken(12);
    db.insert(schema.users).values({ id, email, passwordHash: await hashPassword(password), createdAt: Date.now() }).run();
    createSession(id, reply);
    return { id, email };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const { email, password } = parse(login, req.body);
    const user = db.select().from(schema.users).where(eq(schema.users.email, email)).get();
    if (!user || !(await verifyPassword(password, user.passwordHash))) throw new HttpError(401, 'Wrong email or password.');
    createSession(user.id, reply);
    return { id: user.id, email: user.email };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    destroySession(req.cookies[SESSION_COOKIE], reply);
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireUser }, async (req) => {
    const hasModel = db.select().from(schema.modelProfiles).where(eq(schema.modelProfiles.userId, req.user.id)).get() !== undefined;
    return { ...req.user, hasModel };
  });
};
