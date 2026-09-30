import { chromium } from '/home/user/simpleluma/node_modules/playwright-core/index.mjs';

export const BASE = process.env.LUMA_URL ?? 'http://localhost:3000';
export const LLM_URL = process.env.MOCK_LLM_URL ?? 'http://host.docker.internal:4010/v1';
export const SHOTS = process.env.SHOTS_DIR ?? '/tmp/luma-shots';

export async function launch() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? undefined,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  page.on('console', (m) => m.type() === 'error' && console.log('  [console.error]', m.text().slice(0, 200)));
  return { browser, context, page };
}

let passed = 0;
export async function step(name, fn) {
  const started = Date.now();
  try {
    await fn();
    passed++;
    console.log(`✔ ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } catch (e) {
    console.log(`✘ ${name}\n  ${e.message.split('\n')[0]}`);
    throw e;
  }
}
export const summary = () => console.log(`\n${passed} steps passed`);
