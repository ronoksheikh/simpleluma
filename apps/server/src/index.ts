import './config.js';
import { buildApp } from './app.js';
import { config } from './config.js';
import { migrateDatabase } from './db/index.js';
import './lib/crypto.js';
import { protectData } from './lib/permissions.js';
import { recoverInterruptedRenders } from './render/service.js';

// Files created by the server must stay writable by the sandbox user's group.
process.umask(0o002);
migrateDatabase();
recoverInterruptedRenders();
protectData();

const app = await buildApp();
await app.listen({ port: config.port, host: config.host });
