import { chmod, chown, lchown, mkdir, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve, sep } from 'node:path';
import { badRequest } from './errors.js';

/**
 * In Docker the server runs as root and everything the agent or the user runs (git, shells, scripts) runs as this
 * unprivileged user, so commands can neither read the database and key nor change the app. Outside Docker nothing changes (`LUMA_SANDBOX=off` turns it off when developing as root).
 */
const SANDBOX_ID = 1500;
export const sandboxUser = process.getuid?.() === 0 && process.env.LUMA_SANDBOX !== 'off' ? { uid: SANDBOX_ID, gid: SANDBOX_ID } : undefined;

export async function createProjectDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  if (sandboxUser) {
    await chown(dir, sandboxUser.uid, sandboxUser.gid);
    await chmod(dir, 0o770);
  }
}

/** Environment for commands: no server variables, plus the user's secrets under their names. */
export function commandEnv(secrets: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: sandboxUser ? '/home/sandbox' : homedir(),
    LANG: 'C.UTF-8',
    TERM: 'xterm-256color',
    GIT_AUTHOR_NAME: 'Luma Studio',
    GIT_AUTHOR_EMAIL: 'studio@luma.local',
    GIT_COMMITTER_NAME: 'Luma Studio',
    GIT_COMMITTER_EMAIL: 'studio@luma.local',
    ...secrets,
  };
}

/**
 * Resolve `relative` inside `root`, refusing `..` and symlinks that point outside.
 * Symlinks matter: a script in the sandbox can create one, and the server reads files as root.
 */
export async function safePath(root: string, relative: string): Promise<string> {
  const target = resolve(root, relative);
  if (target !== root && !target.startsWith(root + sep)) throw badRequest(`Path "${relative}" is outside the project.`);
  const realRoot = await realpath(root);
  let probe = target;
  for (;;) {
    try {
      const real = await realpath(probe);
      if (real !== realRoot && !real.startsWith(realRoot + sep)) throw badRequest(`Path "${relative}" is outside the project.`);
      return target;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      probe = dirname(probe);
    }
  }
}

/** Hand files the server wrote as root over to the sandbox user, from `path` up to (not including) `stopAt`. */
export async function giveToSandbox(path: string, stopAt: string): Promise<void> {
  if (!sandboxUser) return;
  for (let p = path; p !== stopAt && p.startsWith(stopAt + sep); p = dirname(p)) {
    await lchown(p, sandboxUser.uid, sandboxUser.gid);
  }
}

export async function giveTreeToSandbox(root: string): Promise<void> {
  if (!sandboxUser) return;
  await lchown(root, sandboxUser.uid, sandboxUser.gid);
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    await lchown(resolve(entry.parentPath, entry.name), sandboxUser.uid, sandboxUser.gid);
  }
}
