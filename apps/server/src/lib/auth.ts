import { and, eq, gt, lt } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { db, schema } from '../db/index.js';
import { HttpError } from './errors.js';
import { randomToken, sha256 } from './crypto.js';

export const SESSION_COOKIE = 'luma_session';
const SESSION_MS = 30 * 24 * 3600 * 1000;

export interface User {
  id: string;
  email: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: User;
  }
}

export function purgeExpiredSessions(): void {
  db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, Date.now())).run();
}

export function createSession(userId: string, reply: FastifyReply): void {
  const token = randomToken();
  db.insert(schema.sessions).values({ tokenHash: sha256(token), userId, expiresAt: Date.now() + SESSION_MS }).run();
  reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: SESSION_MS / 1000 });
}

export function destroySession(token: string | undefined, reply: FastifyReply): void {
  if (token) db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(token))).run();
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function userFromToken(token: string | undefined): User | null {
  if (!token) return null;
  const row = db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.tokenHash, sha256(token)), gt(schema.sessions.expiresAt, Date.now())))
    .get();
  return row ?? null;
}

/** Fastify hook: require a logged-in user and expose it as `req.user`. */
export async function requireUser(req: FastifyRequest): Promise<void> {
  const user = userFromToken(req.cookies[SESSION_COOKIE]);
  if (!user) throw new HttpError(401, 'Please log in.');
  req.user = user;
}
