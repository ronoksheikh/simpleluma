import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { commandEnv, sandboxUser } from './sandbox.js';

const run = promisify(execFile);

export interface CommitInfo {
  sha: string;
  message: string;
  date: number;
  files: number;
  insertions: number;
  deletions: number;
}

const GIT_OPTIONS = { env: commandEnv(), maxBuffer: 64 * 1024 * 1024, ...sandboxUser };

/** Run git in `dir` as the sandbox user (a repo's own config and hooks are sandbox-controlled, so never run them as root). */
export async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', ['-c', 'core.quotepath=off', ...args], { ...GIT_OPTIONS, cwd: dir, encoding: 'utf8' });
  return stdout;
}

export async function gitBuffer(dir: string, args: string[]): Promise<Buffer> {
  const { stdout } = await run('git', args, { ...GIT_OPTIONS, cwd: dir, encoding: 'buffer' });
  return stdout;
}

export async function initRepo(dir: string): Promise<void> {
  await git(dir, ['init', '-q', '-b', 'main']);
  await git(dir, ['config', 'core.sharedRepository', 'group']);
}

export async function head(dir: string): Promise<string | null> {
  try {
    return (await git(dir, ['rev-parse', 'HEAD'])).trim();
  } catch {
    return null;
  }
}

export async function isDirty(dir: string): Promise<boolean> {
  return (await git(dir, ['status', '--porcelain'])).trim().length > 0;
}

/** Commit every change. Returns the new commit, or `null` when there was nothing to commit. */
export async function commitAll(dir: string, message: string): Promise<string | null> {
  await git(dir, ['add', '-A']);
  if (!(await isDirty(dir))) return null;
  await git(dir, ['commit', '-q', '-m', message]);
  return head(dir);
}

export async function log(dir: string, limit = 200): Promise<CommitInfo[]> {
  if (!(await head(dir))) return [];
  const out = await git(dir, ['log', `-${limit}`, '--format=%x01%H%x02%s%x02%ct', '--shortstat']);
  return out
    .split('\x01')
    .filter(Boolean)
    .map((block) => {
      const [header = '', stat = ''] = block.split('\n').filter((l) => l.trim());
      const [sha = '', message = '', date = '0'] = header.split('\x02');
      const num = (re: RegExp): number => Number(re.exec(stat)?.[1] ?? 0);
      return {
        sha,
        message,
        date: Number(date) * 1000,
        files: num(/(\d+) files? changed/),
        insertions: num(/(\d+) insertions?/),
        deletions: num(/(\d+) deletions?/),
      };
    });
}

/** Unified diff of one commit against its parent. */
export async function show(dir: string, sha: string): Promise<string> {
  return git(dir, ['show', '--format=', '--patch', '--no-color', '--find-renames', '--root', sha]);
}

/** Make the working tree match `sha`, as a new commit on top of history. */
export async function restore(dir: string, sha: string): Promise<string | null> {
  await git(dir, ['read-tree', '--reset', '-u', sha]);
  return commitAll(dir, `Restore version ${sha.slice(0, 7)}`);
}

export async function listFilesAt(dir: string, sha: string): Promise<string[]> {
  return (await git(dir, ['ls-tree', '-r', '--name-only', '-z', sha])).split('\0').filter(Boolean);
}

export const readFileAt = (dir: string, sha: string, path: string): Promise<Buffer> => gitBuffer(dir, ['cat-file', 'blob', `${sha}:${path}`]);

export async function shortMessage(dir: string, sha: string): Promise<string> {
  return (await git(dir, ['log', '-1', '--format=%s', sha])).trim();
}

export async function isCommit(dir: string, sha: string): Promise<boolean> {
  try {
    await git(dir, ['cat-file', '-e', `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}
