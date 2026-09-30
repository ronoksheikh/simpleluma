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

const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;
const failures = new Map<string, { count: number; resetAt: number }>();

/** Slow down password guessing: too many wrong passwords for one account pause logins for a few minutes. */
function checkLoginAllowed(email: string): void {
  const entry = failures.get(email);
  if (entry && entry.resetAt > Date.now() && entry.count >= MAX_FAILURES) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
}

function recordFailure(email: string): void {
  const entry = failures.get(email);
  if (!entry || entry.resetAt <= Date.now()) failures.set(email, { count: 1, resetAt: Date.now() + FAILURE_WINDOW_MS });
  else entry.count++;
}

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
    checkLoginAllowed(email);
    const user = db.select().from(schema.users).where(eq(schema.users.email, email)).get();
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      recordFailure(email);
      throw new HttpError(401, 'Wrong email or password.');
    }
    failures.delete(email);
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
