import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.js';

/** Changes whenever the player or framework changes, so cached chunks from an older framework are not reused. */
export const frameworkVersion = createHash('sha1')
  .update(readFileSync(resolve(config.motionDir, 'web/player.js')))
  .update(readFileSync(resolve(config.motionDir, 'web/lib.js')))
  .digest('hex')
  .slice(0, 12);
