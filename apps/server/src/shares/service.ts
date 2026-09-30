import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { randomToken } from '../lib/crypto.js';
import { HttpError, badRequest, notFound } from '../lib/errors.js';
import * as gitRepo from '../lib/git.js';
import { commitProject, projectDir } from '../projects/service.js';
import { getRender } from '../render/service.js';

export type Share = typeof schema.shares.$inferSelect;

export interface ShareInput {
  kind: 'version' | 'render';
  /** Commit sha (version) or render id (render). Defaults to the latest version. */
  target?: string;
  expiresInHours?: number | null;
}

export async function createShare(projectId: string, input: ShareInput): Promise<Share> {
  const dir = projectDir(projectId);
  let target = input.target;
  let label: string;
  if (input.kind === 'version') {
    if (!target) {
      await commitProject(projectId, 'Save changes before sharing');
      target = (await gitRepo.head(dir)) ?? undefined;
    }
    if (!target || !(await gitRepo.isCommit(dir, target))) throw notFound('Version not found');
    target = (await gitRepo.git(dir, ['rev-parse', target])).trim();
    label = `Live preview · ${await gitRepo.shortMessage(dir, target)}`;
  } else {
    if (!target) throw badRequest('Choose a render to share.');
    const render = getRender(projectId, target);
    if (render.status !== 'done') throw badRequest('That render is not finished yet.');
    label = `${render.kind === 'final' ? 'Final 1080p' : 'Quick preview 480p'} render`;
  }
  const share: Share = {
    id: randomToken(9),
    projectId,
    token: randomToken(24),
    kind: input.kind,
    target,
    label,
    expiresAt: input.expiresInHours ? Date.now() + input.expiresInHours * 3600 * 1000 : null,
    revokedAt: null,
    createdAt: Date.now(),
  };
  db.insert(schema.shares).values(share).run();
  return share;
}

export const listShares = (projectId: string): Share[] =>
  db.select().from(schema.shares).where(eq(schema.shares.projectId, projectId)).orderBy(desc(schema.shares.createdAt)).all();

export function revokeShare(projectId: string, id: string): void {
  const where = and(eq(schema.shares.id, id), eq(schema.shares.projectId, projectId));
  if (!db.select().from(schema.shares).where(where).get()) throw notFound('Share link not found');
  db.update(schema.shares).set({ revokedAt: Date.now() }).where(where).run();
}

/** Look up a share by its public token, refusing revoked and expired links. */
export function resolveShare(token: string): Share & { projectName: string } {
  const row = db
    .select({ share: schema.shares, projectName: schema.projects.name })
    .from(schema.shares)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.shares.projectId))
    .where(eq(schema.shares.token, token))
    .get();
  if (!row) throw notFound('This link does not exist.');
  if (row.share.revokedAt) throw new HttpError(410, 'This link has been turned off.');
  if (row.share.expiresAt && row.share.expiresAt < Date.now()) throw new HttpError(410, 'This link has expired.');
  return { ...row.share, projectName: row.projectName };
}
