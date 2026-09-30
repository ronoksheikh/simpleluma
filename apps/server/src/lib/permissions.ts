import { chmodSync, existsSync } from 'node:fs';
import { config } from '../config.js';
import { sandboxUser } from './sandbox.js';

/**
 * In Docker, commands run as another user: let them walk through `data/` to their own project folder,
 * but keep everything else (database, key, renders) readable by the server only.
 */
export function protectData(): void {
  if (!sandboxUser) return;
  chmodSync(config.dataDir, 0o711);
  chmodSync(config.projectsDir, 0o711);
  for (const dir of [config.rendersDir, config.cacheDir, config.framesDir]) chmodSync(dir, 0o700);
  for (const file of [config.dbFile, `${config.dbFile}-wal`, `${config.dbFile}-shm`, config.keyFile]) {
    if (existsSync(file)) chmodSync(file, 0o600);
  }
}
