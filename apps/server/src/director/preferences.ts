import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';

export const preferencesSchema = z.object({
  /** Model turns per run before the Director pauses and asks to continue. */
  stepLimit: z.number().int().min(5).max(500).default(60),
  /** Load the video and draw sample frames after code changes, and hand any errors back to the Director. */
  autoCheck: z.boolean().default(true),
  /** Save a checkpoint automatically every this many steps (0 = only when the Director decides). */
  checkpointEvery: z.number().int().min(0).max(200).default(15),
  /** Fill brand.json by rules as soon as files are uploaded. Off: the Director reads the files and writes it with judgement. */
  autoBrand: z.boolean().default(false),
  /** Ask reasoning models to stream their thinking (when the provider supports it). */
  showThinking: z.boolean().default(true),
});

export type Preferences = z.infer<typeof preferencesSchema>;

export function getPreferences(userId: string): Preferences {
  const row = db.select({ p: schema.users.preferences }).from(schema.users).where(eq(schema.users.id, userId)).get();
  let raw: unknown = {};
  try {
    raw = row?.p ? JSON.parse(row.p) : {};
  } catch {
    raw = {};
  }
  const parsed = preferencesSchema.safeParse(raw);
  return parsed.success ? parsed.data : preferencesSchema.parse({});
}

export function setPreferences(userId: string, patch: Partial<Preferences>): Preferences {
  const next = preferencesSchema.parse({ ...getPreferences(userId), ...patch });
  db.update(schema.users).set({ preferences: JSON.stringify(next) }).where(eq(schema.users.id, userId)).run();
  return next;
}

/** The user's own Director instructions, or `null` for the default. */
export function getDirectorPrompt(userId: string): string | null {
  return db.select({ p: schema.users.directorPrompt }).from(schema.users).where(eq(schema.users.id, userId)).get()?.p ?? null;
}

export function setDirectorPrompt(userId: string, prompt: string | null): void {
  db.update(schema.users).set({ directorPrompt: prompt?.trim() ? prompt : null }).where(eq(schema.users.id, userId)).run();
}
