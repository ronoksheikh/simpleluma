import { watch, type FSWatcher } from 'node:fs';
import { hub } from '../lib/hub.js';
import { projectDir } from './service.js';

interface Entry {
  viewers: number;
  watcher: FSWatcher;
  timer?: NodeJS.Timeout;
}

const entries = new Map<string, Entry>();

/** While someone has the project open, tell them when files change (agent, terminal or restore) so the preview refreshes. */
export function watchProject(projectId: string): () => void {
  let entry = entries.get(projectId);
  if (!entry) {
    const created: Entry = {
      viewers: 0,
      watcher: watch(projectDir(projectId), { recursive: true }, (_event, file) => {
        if (!file || file === '.git' || file.startsWith('.git/') || file.startsWith('.git\\')) return;
        clearTimeout(created.timer);
        created.timer = setTimeout(() => hub.publish(projectId, { type: 'files.changed' }), 300);
      }),
    };
    created.watcher.on('error', () => undefined);
    entry = created;
    entries.set(projectId, entry);
  }
  entry.viewers++;
  return () => {
    entry.viewers--;
    if (entry.viewers <= 0) {
      clearTimeout(entry.timer);
      entry.watcher.close();
      entries.delete(projectId);
    }
  };
}
