import './config.js';
import { buildApp } from './app.js';
import { config } from './config.js';
import { migrateDatabase } from './db/index.js';
import { purgeExpiredSessions } from './lib/auth.js';
import './lib/crypto.js';
import { protectData } from './lib/permissions.js';
import { closeBrowser } from './render/browser.js';
import { recoverInterruptedRenders } from './render/service.js';

// Files created by the server must stay writable by the sandbox user's group.
process.umask(0o002);
migrateDatabase();
recoverInterruptedRenders();
purgeExpiredSessions();
protectData();

const app = await buildApp();
await app.listen({ port: config.port, host: config.host });

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void app.close().then(closeBrowser).finally(() => process.exit(0));
  });
}
