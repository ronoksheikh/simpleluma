import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { randomToken } from '../lib/crypto.js';
import { notFound } from '../lib/errors.js';
import { hub } from '../lib/hub.js';

export interface Memory {
  id: string;
  projectId: string | null;
  content: string;
  source: 'user' | 'director';
  createdAt: number;
}

const MAX_MEMORY_CHARS = 2000;
const MAX_MEMORIES = 200;

/** The user's global memories followed by this project's. */
export function listMemories(userId: string, projectId: string | null): Memory[] {
  const scope = projectId ? or(isNull(schema.memories.projectId), eq(schema.memories.projectId, projectId)) : isNull(schema.memories.projectId);
  return db
    .select({ id: schema.memories.id, projectId: schema.memories.projectId, content: schema.memories.content, source: schema.memories.source, createdAt: schema.memories.createdAt })
    .from(schema.memories)
    .where(and(eq(schema.memories.userId, userId), scope))
    .orderBy(asc(schema.memories.createdAt))
    .all();
}

export function addMemory(userId: string, projectId: string | null, content: string, source: Memory['source']): Memory {
  const existing = listMemories(userId, projectId);
  if (existing.length >= MAX_MEMORIES) throw new Error(`Memory is full (${MAX_MEMORIES} notes). Remove old notes first.`);
  const memory = { id: randomToken(8), userId, projectId, content: content.trim().slice(0, MAX_MEMORY_CHARS), source, createdAt: Date.now() };
  db.insert(schema.memories).values(memory).run();
  if (projectId) hub.publish(projectId, { type: 'memory.changed' });
  return { id: memory.id, projectId, content: memory.content, source, createdAt: memory.createdAt };
}

export function updateMemory(userId: string, id: string, content: string): void {
  const row = db.select().from(schema.memories).where(and(eq(schema.memories.id, id), eq(schema.memories.userId, userId))).get();
  if (!row) throw notFound('Memory not found');
  db.update(schema.memories).set({ content: content.trim().slice(0, MAX_MEMORY_CHARS) }).where(eq(schema.memories.id, id)).run();
  if (row.projectId) hub.publish(row.projectId, { type: 'memory.changed' });
}

export function removeMemory(userId: string, id: string): void {
  const row = db.select().from(schema.memories).where(and(eq(schema.memories.id, id), eq(schema.memories.userId, userId))).get();
  if (!row) throw notFound('Memory not found');
  db.delete(schema.memories).where(eq(schema.memories.id, id)).run();
  if (row.projectId) hub.publish(row.projectId, { type: 'memory.changed' });
}

export function formatMemories(memories: Memory[]): string {
  const global = memories.filter((m) => !m.projectId);
  const local = memories.filter((m) => m.projectId);
  const list = (items: Memory[]): string => items.map((m) => `- (${m.id}) ${m.content}`).join('\n');
  return [
    global.length ? `About the user (every project):\n${list(global)}` : '',
    local.length ? `About this project:\n${list(local)}` : '',
  ].filter(Boolean).join('\n\n') || '(nothing remembered yet)';
}
