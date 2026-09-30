import { readFile } from 'node:fs/promises';
import { git, listFilesAt, readFileAt } from '../lib/git.js';
import { safePath } from '../lib/sandbox.js';
import { notFound } from '../lib/errors.js';


/** A readable snapshot of a project: its working tree, or one git commit. */
export interface ProjectSource {
  list(): Promise<string[]>;
  read(path: string): Promise<Buffer>;
}

export function workingTree(dir: string): ProjectSource {
  return {
    async list() {
      const out = await git(dir, ['ls-files', '-co', '--exclude-standard', '-z']);
      return out.split('\0').filter(Boolean);
    },
    async read(path) {
      try {
        return await readFile(await safePath(dir, path));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'EISDIR') throw notFound(`File not found: ${path}`);
        throw e;
      }
    },
  };
}

export function commitTree(dir: string, sha: string): ProjectSource {
  return {
    list: () => listFilesAt(dir, sha),
    async read(path) {
      try {
        return await readFileAt(dir, sha, path);
      } catch {
        throw notFound(`File not found: ${path}`);
      }
    },
  };
}

