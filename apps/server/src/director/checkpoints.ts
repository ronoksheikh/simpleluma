import { desc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { randomToken } from '../lib/crypto.js';
import { hub } from '../lib/hub.js';
import { head } from '../lib/git.js';
import { commitProject, projectDir } from '../projects/service.js';

export interface Checkpoint {
  id: string;
  runId: string | null;
  summary: string;
  sha: string | null;
  step: number;
  auto: boolean;
  createdAt: number;
}

export const listCheckpoints = (projectId: string, limit = 50): Checkpoint[] =>
  db
    .select({ id: schema.checkpoints.id, runId: schema.checkpoints.runId, summary: schema.checkpoints.summary, sha: schema.checkpoints.sha, step: schema.checkpoints.step, auto: schema.checkpoints.auto, createdAt: schema.checkpoints.createdAt })
    .from(schema.checkpoints)
    .where(eq(schema.checkpoints.projectId, projectId))
    .orderBy(desc(schema.checkpoints.createdAt))
    .limit(limit)
    .all();

export const latestCheckpoint = (projectId: string): Checkpoint | null => listCheckpoints(projectId, 1)[0] ?? null;

/** Commit the work so far and remember where the job stands, so a long job survives context limits and restarts. */
export async function saveCheckpoint(projectId: string, runId: string | null, step: number, summary: string, auto: boolean): Promise<Checkpoint> {
  const committed = await commitProject(projectId, `Checkpoint: ${summary.replace(/\s+/g, ' ').slice(0, 60)}`);
  const sha = committed ?? (await head(projectDir(projectId)));
  const checkpoint: Checkpoint = { id: randomToken(8), runId, summary: summary.trim().slice(0, 4000), sha, step, auto, createdAt: Date.now() };
  db.insert(schema.checkpoints).values({ ...checkpoint, projectId }).run();
  hub.publish(projectId, { type: 'checkpoint', checkpoint });
  return checkpoint;
}
