import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { config } from '../config.js';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

function loadMasterKey(): Buffer {
  if (config.secretKey) return createHash('sha256').update(config.secretKey).digest();
  if (!existsSync(config.keyFile)) writeFileSync(config.keyFile, randomBytes(32).toString('hex'), { mode: 0o600 });
  return createHash('sha256').update(readFileSync(config.keyFile, 'utf8').trim()).digest();
}

const masterKey = loadMasterKey();
const subKey = (purpose: string): Buffer => createHmac('sha256', masterKey).update(purpose).digest();
const encryptionKey = subKey('encrypt');
const signingKey = subKey('sign');

/** AES-256-GCM. Output: `iv.tag.ciphertext`, base64. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function decrypt(payload: string): string {
  const [iv, tag, data] = payload.split('.').map((p) => Buffer.from(p, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv!);
  decipher.setAuthTag(tag!);
  return Buffer.concat([decipher.update(data!), decipher.final()]).toString('utf8');
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString('base64')}.${(await scryptAsync(password, salt, 64)).toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split('.').map((p) => Buffer.from(p, 'base64'));
  const candidate = await scryptAsync(password, salt!, 64);
  return candidate.length === hash!.length && timingSafeEqual(candidate, hash!);
}

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Signed, expiring tokens for URLs that must work without a session cookie (sandboxed preview frames, headless renders). */
export function signToken(payload: Record<string, unknown>, ttlMs: number): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlMs })).toString('base64url');
  return `${body}.${createHmac('sha256', signingKey).update(body).digest('base64url')}`;
}

export function verifyToken<T extends Record<string, unknown>>(token: string): T | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', signingKey).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { exp: number };
  return payload.exp > Date.now() ? payload : null;
}
